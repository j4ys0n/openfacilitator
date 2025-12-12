import { nanoid } from 'nanoid';
import { getDatabase } from './index.js';
import type { MultiSettleSignatureRecord, MultiSettleSettlementRecord } from './types.js';

// Re-export types for convenience
export type { MultiSettleSignatureRecord, MultiSettleSettlementRecord } from './types.js';

/**
 * Create a new multi-settle signature authorization
 */
export function createMultiSettleSignature(data: {
  facilitator_id: string;
  network: string;
  asset: string;
  from_address: string;
  cap_amount: string;
  valid_until: number;
  nonce: string;
  signature: string;
  payment_payload: string;
}): MultiSettleSignatureRecord | null {
  const db = getDatabase();
  const id = nanoid();

  try {
    const stmt = db.prepare(`
      INSERT INTO multisettle_signatures (
        id, facilitator_id, network, asset, from_address,
        cap_amount, remaining_amount, valid_until, nonce,
        signature, payment_payload, status, deposited
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
    `);

    stmt.run(
      id,
      data.facilitator_id,
      data.network,
      data.asset,
      data.from_address.toLowerCase(),
      data.cap_amount,
      data.cap_amount, // remaining starts equal to cap
      data.valid_until,
      data.nonce,
      data.signature,
      data.payment_payload,
    );

    return getMultiSettleSignatureById(id);
  } catch (error) {
    console.error('Failed to create multi-settle signature:', error);
    return null;
  }
}

/**
 * Get a multi-settle signature by ID
 */
export function getMultiSettleSignatureById(id: string): MultiSettleSignatureRecord | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM multisettle_signatures WHERE id = ?');
  return (stmt.get(id) as MultiSettleSignatureRecord) || null;
}

/**
 * Get a multi-settle signature by nonce (for looking up by the original signature's nonce)
 */
export function getMultiSettleSignatureByNonce(
  facilitatorId: string,
  nonce: string
): MultiSettleSignatureRecord | null {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM multisettle_signatures WHERE facilitator_id = ? AND nonce = ?'
  );
  return (stmt.get(facilitatorId, nonce) as MultiSettleSignatureRecord) || null;
}

/**
 * Get active multi-settle signatures for a facilitator
 */
export function getActiveMultiSettleSignatures(
  facilitatorId: string,
  limit = 50,
  offset = 0
): MultiSettleSignatureRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM multisettle_signatures 
    WHERE facilitator_id = ? AND status = 'active'
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `);
  return stmt.all(facilitatorId, limit, offset) as MultiSettleSignatureRecord[];
}

/**
 * Get all multi-settle signatures for a facilitator
 */
export function getMultiSettleSignaturesByFacilitator(
  facilitatorId: string,
  limit = 50,
  offset = 0
): MultiSettleSignatureRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM multisettle_signatures 
    WHERE facilitator_id = ? 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `);
  return stmt.all(facilitatorId, limit, offset) as MultiSettleSignatureRecord[];
}

/**
 * Update remaining amount after a settlement
 * This is atomic - it checks the remaining amount before updating
 * Returns the updated record if successful, null if insufficient balance
 */
export function decrementRemainingAmount(
  signatureId: string,
  amount: string
): MultiSettleSignatureRecord | null {
  const db = getDatabase();

  // Use a transaction to ensure atomicity
  const transaction = db.transaction(() => {
    // Get current signature state
    const signature = getMultiSettleSignatureById(signatureId);
    if (!signature) {
      return null;
    }

    // Check if signature is still active
    if (signature.status !== 'active') {
      return null;
    }

    // Check if signature has expired
    const now = Math.floor(Date.now() / 1000);
    if (signature.valid_until < now) {
      // Mark as expired
      const expireStmt = db.prepare(
        "UPDATE multisettle_signatures SET status = 'expired' WHERE id = ?"
      );
      expireStmt.run(signatureId);
      return null;
    }

    // Check if there's enough remaining balance
    const remainingBigInt = BigInt(signature.remaining_amount);
    const amountBigInt = BigInt(amount);

    if (amountBigInt > remainingBigInt) {
      return null;
    }

    // Calculate new remaining amount
    const newRemaining = (remainingBigInt - amountBigInt).toString();

    // Update remaining amount
    const updateStmt = db.prepare(
      'UPDATE multisettle_signatures SET remaining_amount = ? WHERE id = ?'
    );
    updateStmt.run(newRemaining, signatureId);

    // If remaining is now 0, mark as exhausted
    if (newRemaining === '0') {
      const exhaustStmt = db.prepare(
        "UPDATE multisettle_signatures SET status = 'exhausted' WHERE id = ?"
      );
      exhaustStmt.run(signatureId);
    }

    return getMultiSettleSignatureById(signatureId);
  });

  return transaction();
}

/**
 * Revoke a multi-settle signature
 */
export function revokeMultiSettleSignature(signatureId: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(
    "UPDATE multisettle_signatures SET status = 'revoked' WHERE id = ? AND status = 'active'"
  );
  const result = stmt.run(signatureId);

  return result.changes > 0;
}

/**
 * Revoke a multi-settle signature by nonce
 */
export function revokeMultiSettleSignatureByNonce(
  facilitatorId: string,
  nonce: string
): boolean {
  const db = getDatabase();

  const stmt = db.prepare(
    "UPDATE multisettle_signatures SET status = 'revoked' WHERE facilitator_id = ? AND nonce = ? AND status = 'active'"
  );
  const result = stmt.run(facilitatorId, nonce);

  return result.changes > 0;
}

/**
 * Create a settlement record for a multi-settle signature
 */
export function createMultiSettleSettlement(data: {
  signature_id: string;
  facilitator_id: string;
  pay_to: string;
  amount: string;
  transaction_hash?: string;
  status: 'pending' | 'success' | 'failed';
  error_message?: string;
}): MultiSettleSettlementRecord | null {
  const db = getDatabase();
  const id = nanoid();

  try {
    const stmt = db.prepare(`
      INSERT INTO multisettle_settlements (
        id, signature_id, facilitator_id, pay_to, amount,
        transaction_hash, status, error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.signature_id,
      data.facilitator_id,
      data.pay_to.toLowerCase(),
      data.amount,
      data.transaction_hash || null,
      data.status,
      data.error_message || null
    );

    return getMultiSettleSettlementById(id);
  } catch (error) {
    console.error('Failed to create multi-settle settlement:', error);
    return null;
  }
}

/**
 * Get a multi-settle settlement by ID
 */
export function getMultiSettleSettlementById(id: string): MultiSettleSettlementRecord | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM multisettle_settlements WHERE id = ?');
  return (stmt.get(id) as MultiSettleSettlementRecord) || null;
}

/**
 * Get settlements for a multi-settle signature
 */
export function getSettlementsBySignatureId(
  signatureId: string
): MultiSettleSettlementRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM multisettle_settlements 
    WHERE signature_id = ? 
    ORDER BY created_at ASC
  `);
  return stmt.all(signatureId) as MultiSettleSettlementRecord[];
}

/**
 * Update settlement status
 */
export function updateMultiSettleSettlementStatus(
  id: string,
  status: 'pending' | 'success' | 'failed',
  transactionHash?: string,
  errorMessage?: string
): MultiSettleSettlementRecord | null {
  const db = getDatabase();

  const fields: string[] = ['status = ?'];
  const values: (string | null)[] = [status];

  if (transactionHash !== undefined) {
    fields.push('transaction_hash = ?');
    values.push(transactionHash);
  }
  if (errorMessage !== undefined) {
    fields.push('error_message = ?');
    values.push(errorMessage);
  }

  values.push(id);

  const stmt = db.prepare(
    `UPDATE multisettle_settlements SET ${fields.join(', ')} WHERE id = ?`
  );
  const result = stmt.run(...values);

  if (result.changes === 0) {
    return null;
  }

  return getMultiSettleSettlementById(id);
}

/**
 * Get multi-settle signature statistics for a facilitator
 */
export function getMultiSettleStats(facilitatorId: string): {
  totalSignatures: number;
  activeSignatures: number;
  totalSettlements: number;
  totalAmountAuthorized: string;
  totalAmountSettled: string;
} {
  const db = getDatabase();

  const totalSigStmt = db.prepare(
    'SELECT COUNT(*) as count FROM multisettle_signatures WHERE facilitator_id = ?'
  );
  const totalSignatures = (totalSigStmt.get(facilitatorId) as { count: number }).count;

  const activeSigStmt = db.prepare(
    "SELECT COUNT(*) as count FROM multisettle_signatures WHERE facilitator_id = ? AND status = 'active'"
  );
  const activeSignatures = (activeSigStmt.get(facilitatorId) as { count: number }).count;

  const totalSettlementsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM multisettle_settlements WHERE facilitator_id = ? AND status = 'success'"
  );
  const totalSettlements = (totalSettlementsStmt.get(facilitatorId) as { count: number }).count;

  // Calculate total amount authorized
  const authorizedStmt = db.prepare(
    'SELECT COALESCE(SUM(CAST(cap_amount AS INTEGER)), 0) as total FROM multisettle_signatures WHERE facilitator_id = ?'
  );
  const totalAuthorizedAtomic = (authorizedStmt.get(facilitatorId) as { total: number }).total;
  const totalAmountAuthorized = (totalAuthorizedAtomic / 1_000_000).toFixed(2);

  // Calculate total amount settled
  const settledStmt = db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM multisettle_settlements WHERE facilitator_id = ? AND status = 'success'"
  );
  const totalSettledAtomic = (settledStmt.get(facilitatorId) as { total: number }).total;
  const totalAmountSettled = (totalSettledAtomic / 1_000_000).toFixed(2);

  return {
    totalSignatures,
    activeSignatures,
    totalSettlements,
    totalAmountAuthorized,
    totalAmountSettled,
  };
}

/**
 * Clean up expired signatures (can be called periodically)
 */
export function cleanupExpiredSignatures(): number {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(
    "UPDATE multisettle_signatures SET status = 'expired' WHERE status = 'active' AND valid_until < ?"
  );
  const result = stmt.run(now);

  return result.changes;
}

/**
 * Mark a multi-settle signature as having funds deposited
 */
export function markSignatureDeposited(signatureId: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(
    'UPDATE multisettle_signatures SET deposited = 1 WHERE id = ?'
  );
  const result = stmt.run(signatureId);

  return result.changes > 0;
}

