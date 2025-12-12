import { Router, type Request, type Response, type IRouter } from 'express';
import { createFacilitator, type FacilitatorConfig, type TokenConfig } from '@openfacilitator/core';
import { z } from 'zod';
import { requireFacilitator } from '../middleware/tenant.js';
import {
  createMultiSettleSignature,
  getMultiSettleSignatureById,
  getMultiSettleSignatureByNonce,
  decrementRemainingAmount,
  revokeMultiSettleSignature,
  createMultiSettleSettlement,
  updateMultiSettleSettlementStatus,
  getSettlementsBySignatureId,
  getActiveMultiSettleSignatures,
  markSignatureDeposited,
  type MultiSettleSignatureRecord,
} from '../db/multisettle.js';
import { decryptPrivateKey } from '../utils/crypto.js';
import type { Hex, Address } from 'viem';
import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  encodeFunctionData,
  erc20Abi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, mainnet, sepolia } from 'viem/chains';
import { executeERC3009Settlement, type ERC3009Authorization } from '@openfacilitator/core';

const router: IRouter = Router();

// Chain configurations
const chainConfigs = {
  8453: { chain: base, rpcUrl: 'https://mainnet.base.org' },
  84532: { chain: baseSepolia, rpcUrl: 'https://sepolia.base.org' },
  1: { chain: mainnet, rpcUrl: 'https://eth.llamarpc.com' },
  11155111: { chain: sepolia, rpcUrl: 'https://rpc.sepolia.org' },
} as const;

// Network to chain ID mapping
const networkToChainId: Record<string, number> = {
  'base': 8453,
  'base-sepolia': 84532,
  'ethereum': 1,
  'sepolia': 11155111,
};

// Payment requirements schema
const paymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  maxAmountRequired: z.string(),
  resource: z.string().default(''),
  asset: z.string(),
  payTo: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  maxTimeoutSeconds: z.number().optional(),
  outputSchema: z.record(z.unknown()).optional(),
  extra: z.record(z.unknown()).optional(),
});

// Authorization request schema
const authorizeRequestSchema = z.object({
  x402Version: z.number().optional(),
  paymentPayload: z.union([z.string(), z.object({}).passthrough()]),
  paymentRequirements: paymentRequirementsSchema,
  capAmount: z.string(),
  validUntil: z.number(),
});

// Settlement request schema
const settleRequestSchema = z.object({
  authorizationId: z.string(),
  payTo: z.string(),
  amount: z.string(),
});

// Revocation request schema
const revokeRequestSchema = z.object({
  authorizationId: z.string(),
});

/**
 * Normalize paymentPayload to string format
 */
function normalizePaymentPayload(payload: string | object): string {
  if (typeof payload === 'string') {
    return payload;
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Extract authorization details from payment payload
 */
function extractAuthorizationFromPayload(paymentPayload: string): {
  authorization: ERC3009Authorization;
  signature: Hex;
  from: string;
  to: string;
  nonce: string;
  value: string;
} | null {
  try {
    const decoded = Buffer.from(paymentPayload, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded);

    // Handle both flat and nested formats
    let authorization = payload.authorization || payload.payload?.authorization;
    let signature = payload.signature || payload.payload?.signature;

    if (!authorization || !signature) {
      return null;
    }

    return {
      authorization: {
        from: authorization.from as Address,
        to: authorization.to as Address,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce as Hex,
      },
      signature: signature as Hex,
      from: authorization.from,
      to: authorization.to,
      nonce: authorization.nonce,
      value: authorization.value,
    };
  } catch {
    return null;
  }
}

/**
 * Transfer ERC20 tokens from facilitator wallet to recipient
 */
async function transferTokens(params: {
  chainId: number;
  tokenAddress: Address;
  to: Address;
  amount: string;
  facilitatorPrivateKey: Hex;
}): Promise<{ success: boolean; transactionHash?: Hex; errorMessage?: string }> {
  const { chainId, tokenAddress, to, amount, facilitatorPrivateKey } = params;

  const config = chainConfigs[chainId as keyof typeof chainConfigs];
  if (!config) {
    return { success: false, errorMessage: `Unsupported chain ID: ${chainId}` };
  }

  try {
    const account = privateKeyToAccount(facilitatorPrivateKey);

    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    // Encode transfer function data
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, BigInt(amount)],
    });

    // Get gas price
    const gasPrice = await publicClient.getGasPrice();

    // Send transaction
    const hash = await walletClient.sendTransaction({
      to: tokenAddress,
      data,
      gas: 100000n,
      gasPrice,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status === 'success') {
      return { success: true, transactionHash: hash };
    } else {
      return { 
        success: false, 
        transactionHash: hash,
        errorMessage: 'Transaction reverted' 
      };
    }
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Transfer failed',
    };
  }
}

/**
 * Check if the facilitator has sufficient token balance
 */
async function checkFacilitatorBalance(params: {
  chainId: number;
  tokenAddress: Address;
  facilitatorAddress: Address;
  requiredAmount: string;
}): Promise<{ sufficient: boolean; balance: string }> {
  const { chainId, tokenAddress, facilitatorAddress, requiredAmount } = params;

  const config = chainConfigs[chainId as keyof typeof chainConfigs];
  if (!config) {
    return { sufficient: false, balance: '0' };
  }

  try {
    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [facilitatorAddress],
    });

    const balanceStr = balance.toString();
    const sufficient = BigInt(balanceStr) >= BigInt(requiredAmount);

    return { sufficient, balance: balanceStr };
  } catch (error) {
    console.error('Failed to check balance:', error);
    return { sufficient: false, balance: '0' };
  }
}

/**
 * POST /authorize - Create a multi-settle authorization
 * 
 * This registers a pre-signed authorization that can be settled multiple times
 * against different recipients, up to the spending cap.
 * 
 * The flow works as follows:
 * 1. User signs a transferWithAuthorization to transfer funds TO the facilitator
 * 2. The facilitator deposits those funds on the first settlement
 * 3. Subsequent settlements are paid from the facilitator's balance
 */
router.post('/authorize', requireFacilitator, async (req: Request, res: Response) => {
  try {
    const parsed = authorizeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        errorMessage: 'Invalid request',
        details: parsed.error.issues,
      });
      return;
    }

    const { paymentRequirements, capAmount, validUntil } = parsed.data;
    const paymentPayload = normalizePaymentPayload(parsed.data.paymentPayload);
    const record = req.facilitator!;

    // Validate the signature first
    const config: FacilitatorConfig = {
      id: record.id,
      name: record.name,
      subdomain: record.subdomain,
      customDomain: record.custom_domain || undefined,
      ownerAddress: record.owner_address as `0x${string}`,
      supportedChains: JSON.parse(record.supported_chains),
      supportedTokens: JSON.parse(record.supported_tokens) as TokenConfig[],
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    };

    const facilitator = createFacilitator(config);

    // Verify the payment signature is valid
    // For multi-settle, we use the capAmount as the maxAmountRequired for verification
    const verifyRequirements = {
      ...paymentRequirements,
      maxAmountRequired: capAmount,
    };
    const verification = await facilitator.verify(paymentPayload, verifyRequirements);

    if (!verification.valid) {
      res.status(400).json({
        success: false,
        errorMessage: verification.invalidReason || 'Invalid signature',
      });
      return;
    }

    // Extract authorization details
    const authDetails = extractAuthorizationFromPayload(paymentPayload);
    if (!authDetails) {
      res.status(400).json({
        success: false,
        errorMessage: 'Failed to extract authorization from payload',
      });
      return;
    }

    // For multi-settle to work correctly, the signature should authorize transfer
    // TO the facilitator wallet. This allows the facilitator to receive the funds
    // and then distribute them to multiple recipients.
    // We don't enforce this here but document it as a requirement.

    // Check if this nonce was already used
    const existingAuth = getMultiSettleSignatureByNonce(record.id, authDetails.nonce);
    if (existingAuth) {
      // Return the existing authorization if still active
      if (existingAuth.status === 'active') {
        res.json({
          success: true,
          authorizationId: existingAuth.id,
          capAmount: existingAuth.cap_amount,
          remainingAmount: existingAuth.remaining_amount,
          validUntil: existingAuth.valid_until,
          nonce: existingAuth.nonce,
          deposited: existingAuth.deposited === 1,
        });
        return;
      } else {
        res.status(400).json({
          success: false,
          errorMessage: `Authorization with this nonce already exists and is ${existingAuth.status}`,
        });
        return;
      }
    }

    // Validate validUntil is in the future
    const now = Math.floor(Date.now() / 1000);
    if (validUntil <= now) {
      res.status(400).json({
        success: false,
        errorMessage: 'validUntil must be in the future',
      });
      return;
    }

    // Validate capAmount matches the authorization value
    if (authDetails.value !== capAmount) {
      res.status(400).json({
        success: false,
        errorMessage: `Cap amount (${capAmount}) must match authorization value (${authDetails.value})`,
      });
      return;
    }

    // Create the multi-settle signature record
    const signature = createMultiSettleSignature({
      facilitator_id: record.id,
      network: paymentRequirements.network,
      asset: paymentRequirements.asset,
      from_address: authDetails.from,
      cap_amount: capAmount,
      valid_until: validUntil,
      nonce: authDetails.nonce,
      signature: authDetails.signature,
      payment_payload: paymentPayload,
    });

    if (!signature) {
      res.status(500).json({
        success: false,
        errorMessage: 'Failed to create authorization',
      });
      return;
    }

    res.json({
      success: true,
      authorizationId: signature.id,
      capAmount: signature.cap_amount,
      remainingAmount: signature.remaining_amount,
      validUntil: signature.valid_until,
      nonce: signature.nonce,
      deposited: false,
    });
  } catch (error) {
    console.error('Multi-settle authorize error:', error);
    res.status(500).json({
      success: false,
      errorMessage: 'Internal server error',
    });
  }
});

/**
 * POST /settle - Settle a portion of a multi-settle authorization
 * 
 * This settles a specific amount to a specific recipient from an existing
 * multi-settle authorization.
 * 
 * On the first settlement:
 * - Executes the ERC-3009 transferWithAuthorization to receive funds
 * - Marks the authorization as "deposited"
 * - Transfers the requested amount to the payTo address
 * 
 * On subsequent settlements:
 * - Transfers from facilitator's balance to the payTo address
 */
router.post('/settle', requireFacilitator, async (req: Request, res: Response) => {
  try {
    const parsed = settleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        errorMessage: 'Invalid request',
        details: parsed.error.issues,
      });
      return;
    }

    const { authorizationId, payTo, amount } = parsed.data;
    const record = req.facilitator!;

    // Get the multi-settle signature
    const signature = getMultiSettleSignatureById(authorizationId);
    if (!signature) {
      res.status(404).json({
        success: false,
        errorMessage: 'Authorization not found',
      });
      return;
    }

    // Verify this facilitator owns the authorization
    if (signature.facilitator_id !== record.id) {
      res.status(403).json({
        success: false,
        errorMessage: 'Authorization does not belong to this facilitator',
      });
      return;
    }

    // Check if signature is still active
    if (signature.status !== 'active') {
      res.status(400).json({
        success: false,
        errorMessage: `Authorization is ${signature.status}`,
        remainingAmount: signature.remaining_amount,
      });
      return;
    }

    // Check if signature has expired
    const now = Math.floor(Date.now() / 1000);
    if (signature.valid_until < now) {
      res.status(400).json({
        success: false,
        errorMessage: 'Authorization has expired',
        remainingAmount: signature.remaining_amount,
      });
      return;
    }

    // Check if amount exceeds remaining balance
    const remainingBigInt = BigInt(signature.remaining_amount);
    const amountBigInt = BigInt(amount);
    if (amountBigInt > remainingBigInt) {
      res.status(400).json({
        success: false,
        errorMessage: `Amount ${amount} exceeds remaining balance ${signature.remaining_amount}`,
        remainingAmount: signature.remaining_amount,
      });
      return;
    }

    if (amountBigInt <= 0n) {
      res.status(400).json({
        success: false,
        errorMessage: 'Amount must be greater than 0',
        remainingAmount: signature.remaining_amount,
      });
      return;
    }

    // Get chain ID
    const chainId = networkToChainId[signature.network];
    if (!chainId) {
      res.status(400).json({
        success: false,
        errorMessage: `Unsupported network: ${signature.network}`,
      });
      return;
    }

    // Check for Solana (not yet supported)
    const isSolanaNetwork = signature.network === 'solana' || 
                           signature.network === 'solana-mainnet' || 
                           signature.network === 'solana-devnet';
    
    if (isSolanaNetwork) {
      res.status(400).json({
        success: false,
        errorMessage: 'Multi-settle for Solana is not yet supported',
      });
      return;
    }

    // Get EVM private key
    if (!record.encrypted_private_key) {
      res.status(400).json({
        success: false,
        errorMessage: 'EVM wallet not configured',
      });
      return;
    }

    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(record.encrypted_private_key);
    } catch (e) {
      console.error('Failed to decrypt EVM private key:', e);
      res.status(500).json({
        success: false,
        errorMessage: 'Failed to decrypt wallet',
      });
      return;
    }

    const facilitatorAccount = privateKeyToAccount(privateKey as Hex);

    // Atomically decrement the remaining amount FIRST
    // This reserves the amount before any on-chain operations
    const updatedSignature = decrementRemainingAmount(authorizationId, amount);
    if (!updatedSignature) {
      res.status(400).json({
        success: false,
        errorMessage: 'Failed to reserve amount - insufficient balance or authorization is no longer active',
        remainingAmount: signature.remaining_amount,
      });
      return;
    }

    // Create a settlement record
    const settlement = createMultiSettleSettlement({
      signature_id: authorizationId,
      facilitator_id: record.id,
      pay_to: payTo,
      amount: amount,
      status: 'pending',
    });

    if (!settlement) {
      console.error('Failed to create settlement record');
      res.status(500).json({
        success: false,
        errorMessage: 'Internal error creating settlement record',
      });
      return;
    }

    try {
      // Check if this is the first settlement (needs to deposit funds first)
      const needsDeposit = signature.deposited === 0;

      if (needsDeposit) {
        console.log('[MultiSettle] First settlement - depositing funds to facilitator');
        
        // Extract the original authorization
        const authDetails = extractAuthorizationFromPayload(signature.payment_payload);
        if (!authDetails) {
          updateMultiSettleSettlementStatus(settlement.id, 'failed', undefined, 'Failed to extract authorization');
          res.status(500).json({
            success: false,
            errorMessage: 'Failed to extract authorization from stored payload',
          });
          return;
        }

        // Execute the ERC-3009 transfer to get funds INTO the facilitator wallet
        // The 'to' address in the authorization should be the facilitator's wallet
        const depositResult = await executeERC3009Settlement({
          chainId,
          tokenAddress: signature.asset as Address,
          authorization: authDetails.authorization,
          signature: authDetails.signature,
          facilitatorPrivateKey: privateKey as Hex,
        });

        if (!depositResult.success) {
          updateMultiSettleSettlementStatus(settlement.id, 'failed', undefined, depositResult.errorMessage);
          res.status(400).json({
            success: false,
            errorMessage: `Failed to deposit funds: ${depositResult.errorMessage}`,
            remainingAmount: updatedSignature.remaining_amount,
            network: signature.network,
          });
          return;
        }

        console.log('[MultiSettle] Deposit successful:', depositResult.transactionHash);

        // Mark the signature as deposited
        markSignatureDeposited(authorizationId);
      }

      // Now transfer from facilitator to payTo
      console.log('[MultiSettle] Transferring', amount, 'to', payTo);

      // Check facilitator has sufficient balance
      const balanceCheck = await checkFacilitatorBalance({
        chainId,
        tokenAddress: signature.asset as Address,
        facilitatorAddress: facilitatorAccount.address,
        requiredAmount: amount,
      });

      if (!balanceCheck.sufficient) {
        updateMultiSettleSettlementStatus(
          settlement.id, 
          'failed', 
          undefined, 
          `Insufficient facilitator balance: ${balanceCheck.balance} < ${amount}`
        );
        res.status(400).json({
          success: false,
          errorMessage: `Facilitator has insufficient balance for transfer`,
          remainingAmount: updatedSignature.remaining_amount,
          network: signature.network,
        });
        return;
      }

      // Transfer to payTo
      const transferResult = await transferTokens({
        chainId,
        tokenAddress: signature.asset as Address,
        to: payTo as Address,
        amount,
        facilitatorPrivateKey: privateKey as Hex,
      });

      if (transferResult.success) {
        updateMultiSettleSettlementStatus(settlement.id, 'success', transferResult.transactionHash);
        res.json({
          success: true,
          transactionHash: transferResult.transactionHash,
          remainingAmount: updatedSignature.remaining_amount,
          network: signature.network,
        });
      } else {
        updateMultiSettleSettlementStatus(settlement.id, 'failed', undefined, transferResult.errorMessage);
        res.status(400).json({
          success: false,
          errorMessage: transferResult.errorMessage,
          remainingAmount: updatedSignature.remaining_amount,
          network: signature.network,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Settlement execution failed';
      updateMultiSettleSettlementStatus(settlement.id, 'failed', undefined, errorMessage);
      res.status(500).json({
        success: false,
        errorMessage,
        remainingAmount: updatedSignature.remaining_amount,
        network: signature.network,
      });
    }
  } catch (error) {
    console.error('Multi-settle settle error:', error);
    res.status(500).json({
      success: false,
      errorMessage: 'Internal server error',
    });
  }
});

/**
 * GET /status/:authorizationId - Get status of a multi-settle authorization
 */
router.get('/status/:authorizationId', requireFacilitator, async (req: Request, res: Response) => {
  try {
    const { authorizationId } = req.params;
    const record = req.facilitator!;

    const signature = getMultiSettleSignatureById(authorizationId);
    if (!signature) {
      res.status(404).json({
        success: false,
        errorMessage: 'Authorization not found',
      });
      return;
    }

    // Verify this facilitator owns the authorization
    if (signature.facilitator_id !== record.id) {
      res.status(403).json({
        success: false,
        errorMessage: 'Authorization does not belong to this facilitator',
      });
      return;
    }

    // Get all settlements for this authorization
    const settlements = getSettlementsBySignatureId(authorizationId);

    res.json({
      authorizationId: signature.id,
      status: signature.status,
      network: signature.network,
      asset: signature.asset,
      fromAddress: signature.from_address,
      capAmount: signature.cap_amount,
      remainingAmount: signature.remaining_amount,
      validUntil: signature.valid_until,
      deposited: signature.deposited === 1,
      createdAt: signature.created_at,
      settlements: settlements.map(s => ({
        id: s.id,
        payTo: s.pay_to,
        amount: s.amount,
        transactionHash: s.transaction_hash,
        status: s.status,
        createdAt: s.created_at,
      })),
    });
  } catch (error) {
    console.error('Multi-settle status error:', error);
    res.status(500).json({
      success: false,
      errorMessage: 'Internal server error',
    });
  }
});

/**
 * POST /revoke - Revoke a multi-settle authorization
 * 
 * Note: This only prevents future settlements. If funds have already been
 * deposited to the facilitator, they remain there. The facilitator operator
 * should return unused funds to the original sender.
 */
router.post('/revoke', requireFacilitator, async (req: Request, res: Response) => {
  try {
    const parsed = revokeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        errorMessage: 'Invalid request',
        details: parsed.error.issues,
      });
      return;
    }

    const { authorizationId } = parsed.data;
    const record = req.facilitator!;

    // Get the signature to verify ownership
    const signature = getMultiSettleSignatureById(authorizationId);
    if (!signature) {
      res.status(404).json({
        success: false,
        errorMessage: 'Authorization not found',
      });
      return;
    }

    // Verify this facilitator owns the authorization
    if (signature.facilitator_id !== record.id) {
      res.status(403).json({
        success: false,
        errorMessage: 'Authorization does not belong to this facilitator',
      });
      return;
    }

    // Check if already inactive
    if (signature.status !== 'active') {
      res.status(400).json({
        success: false,
        errorMessage: `Authorization is already ${signature.status}`,
      });
      return;
    }

    const success = revokeMultiSettleSignature(authorizationId);
    if (!success) {
      res.status(500).json({
        success: false,
        errorMessage: 'Failed to revoke authorization',
      });
      return;
    }

    res.json({
      success: true,
      remainingAmount: signature.remaining_amount,
      deposited: signature.deposited === 1,
    });
  } catch (error) {
    console.error('Multi-settle revoke error:', error);
    res.status(500).json({
      success: false,
      errorMessage: 'Internal server error',
    });
  }
});

/**
 * GET /active - List all active multi-settle authorizations for this facilitator
 */
router.get('/active', requireFacilitator, async (req: Request, res: Response) => {
  try {
    const record = req.facilitator!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const signatures = getActiveMultiSettleSignatures(record.id, limit, offset);

    res.json({
      authorizations: signatures.map(s => ({
        authorizationId: s.id,
        status: s.status,
        network: s.network,
        asset: s.asset,
        fromAddress: s.from_address,
        capAmount: s.cap_amount,
        remainingAmount: s.remaining_amount,
        validUntil: s.valid_until,
        deposited: s.deposited === 1,
        createdAt: s.created_at,
      })),
      count: signatures.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Multi-settle active list error:', error);
    res.status(500).json({
      success: false,
      errorMessage: 'Internal server error',
    });
  }
});

export { router as multiSettleRouter };
