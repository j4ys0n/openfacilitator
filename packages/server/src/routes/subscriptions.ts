import { Router, type Request, type Response, type IRouter } from 'express';
import { z } from 'zod';
import {
  createSubscription,
  getActiveSubscription,
  extendSubscription,
  SUBSCRIPTION_PRICING,
  type SubscriptionTier,
} from '../db/subscriptions.js';
import { getUserWalletByUserId } from '../db/user-wallets.js';
import { decryptPrivateKey } from '../utils/crypto.js';
import { makeX402Payment } from '../services/x402-client.js';
import { requireAuth } from '../middleware/auth.js';

// x402jobs payment endpoint
const X402_JOBS_PAYMENT_URL = process.env.X402_JOBS_PAYMENT_URL || 'https://api.x402.jobs/@openfacilitator/openfacilitator-payment-collector';

const router: IRouter = Router();

/**
 * GET /api/subscriptions/status
 * Get subscription status for authenticated user
 */
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const subscription = getActiveSubscription(userId);

    if (!subscription) {
      res.json({
        active: false,
        tier: null,
        expires: null,
      });
      return;
    }

    res.json({
      active: true,
      tier: subscription.tier,
      expires: subscription.expires_at,
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/subscriptions/pricing
 * Get subscription pricing (public endpoint)
 */
router.get('/pricing', (_req: Request, res: Response) => {
  res.json({
    starter: {
      price: SUBSCRIPTION_PRICING.starter,
      priceFormatted: '$5.00',
      currency: 'USDC',
      period: '30 days',
    },
  });
});

// Validation schema for purchase endpoint (tier is optional, defaults to starter)
const purchaseSchema = z.object({
  tier: z.enum(['starter']).optional().default('starter'),
});

/**
 * POST /api/subscriptions/purchase
 * Purchase a subscription using the user's custodial wallet via x402
 *
 * This endpoint:
 * 1. Gets the user's Solana wallet
 * 2. Makes an x402 payment to x402jobs payment collector
 * 3. Creates the subscription directly with the tx hash
 * 4. Returns the subscription details
 */
router.post('/purchase', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = purchaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues,
      });
      return;
    }

    const subscriptionTier: SubscriptionTier = 'starter';
    const userId = req.user!.id;

    console.log(`[Purchase] User ${userId} attempting to purchase subscription`);

    // Get user's wallet
    const wallet = getUserWalletByUserId(userId);
    if (!wallet) {
      res.status(400).json({
        success: false,
        error: 'No wallet found',
        message: 'You need to create a billing wallet first. Go to your account settings.',
      });
      return;
    }

    // Decrypt private key
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(wallet.encrypted_private_key);
    } catch (error) {
      console.error('[Purchase] Failed to decrypt wallet:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to access wallet',
      });
      return;
    }

    // Get x402jobs endpoint
    const endpoint = X402_JOBS_PAYMENT_URL;
    console.log(`[Purchase] Calling x402jobs endpoint: ${endpoint}`);

    // Make x402 payment to x402jobs
    const result = await makeX402Payment(
      endpoint,
      {}, // x402jobs doesn't need a body - it's just a payment gate
      privateKey,
      wallet.wallet_address
    );

    // Clear private key from memory
    privateKey = '';

    if (!result.success) {
      console.log(`[Purchase] Payment failed:`, result.error);

      if (result.insufficientBalance) {
        res.status(402).json({
          success: false,
          error: 'Insufficient balance',
          message: `You need $${result.required} USDC but only have $${result.available}`,
          required: result.required,
          available: result.available,
        });
        return;
      }

      res.status(400).json({
        success: false,
        error: result.error || 'Payment failed',
      });
      return;
    }

    // Extract transaction signature from x402jobs response
    // Response format: { success: true, message: "...", payment: { signature, payer, amount, timestamp } }
    const responseData = result.data as Record<string, unknown> | undefined;
    const payment = responseData?.payment as Record<string, string> | undefined;
    const txHash = payment?.signature || result.txHash;

    console.log(`[Purchase] Payment successful for user ${userId}, txHash: ${txHash}`);

    // Create subscription directly with tx hash
    const SUBSCRIPTION_DAYS = 30;
    const existingSub = getActiveSubscription(userId);
    let subscription;

    if (existingSub) {
      // Extend existing subscription
      subscription = extendSubscription(existingSub.id, SUBSCRIPTION_DAYS, subscriptionTier, txHash);
      console.log(`[Purchase] Extended subscription for user ${userId}: ${subscription?.expires_at}`);
    } else {
      // Create new subscription
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + SUBSCRIPTION_DAYS);

      subscription = createSubscription(userId, subscriptionTier, expiresAt, txHash);
      console.log(`[Purchase] Created new subscription for user ${userId}: expires ${subscription.expires_at}`);
    }

    if (!subscription) {
      // Payment succeeded but subscription creation failed - this is bad
      console.error(`[Purchase] CRITICAL: Payment succeeded but subscription creation failed for user ${userId}`);
      res.status(500).json({
        success: false,
        error: 'Subscription creation failed after payment. Please contact support.',
        txHash,
      });
      return;
    }

    res.json({
      success: true,
      tier: subscription.tier,
      expires: subscription.expires_at,
      txHash,
    });
  } catch (error) {
    console.error('[Purchase] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export { router as subscriptionsRouter };
