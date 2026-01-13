'use client';

import { useMemo } from 'react';
import { Trophy, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAddress, isValidAddressFormat } from '@/lib/utils';
import type { Transaction } from '@/lib/api';

/**
 * Check if network is Solana mainnet (handles multiple formats)
 */
function isSolanaMainnet(network: string): boolean {
  return network === 'solana' ||
         network === 'solana-mainnet' ||
         network.startsWith('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
}

/**
 * Check if network is Solana devnet
 */
function isSolanaDevnet(network: string): boolean {
  return network === 'solana-devnet' ||
         network.startsWith('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
}

/**
 * Check if network is any Solana network
 */
function isSolanaNetwork(network: string): boolean {
  return isSolanaMainnet(network) || isSolanaDevnet(network) || network.startsWith('solana:');
}

/**
 * Get explorer URL for an address based on network
 */
function getAddressExplorerUrl(address: string, network: string): string | null {
  if (!isValidAddressFormat(address)) return null;

  if (isSolanaMainnet(network)) {
    return `https://solscan.io/account/${address}`;
  }
  if (isSolanaDevnet(network)) {
    return `https://solscan.io/account/${address}?cluster=devnet`;
  }
  if (isSolanaNetwork(network)) {
    return `https://solscan.io/account/${address}`;
  }
  if (network === '8453' || network === 'base') {
    return `https://basescan.org/address/${address}`;
  }
  if (network === '84532' || network === 'base-sepolia') {
    return `https://sepolia.basescan.org/address/${address}`;
  }
  if (network === '1' || network === 'ethereum') {
    return `https://etherscan.io/address/${address}`;
  }
  return null;
}

interface SenderStats {
  address: string;
  network: string;
  totalAmount: number;
  transactionCount: number;
}

interface SenderLeaderboardProps {
  transactions: Transaction[];
  limit?: number;
}

export function SenderLeaderboard({ transactions, limit = 10 }: SenderLeaderboardProps) {
  const leaderboard = useMemo(() => {
    // Only include successful settle transactions with valid sender addresses
    const settleTransactions = transactions.filter(
      tx => tx.type === 'settle' &&
            tx.status === 'success' &&
            tx.fromAddress &&
            tx.fromAddress !== 'unknown' &&
            tx.fromAddress !== 'unknown-solana-sender' &&
            tx.fromAddress !== 'solana-payer' &&
            isValidAddressFormat(tx.fromAddress)
    );

    // Group by sender address
    const senderMap = new Map<string, SenderStats>();

    for (const tx of settleTransactions) {
      const existing = senderMap.get(tx.fromAddress);
      // Parse amount - handle both string amounts like "1000000" (atomic units) and "1.50" (decimal)
      let amount = 0;
      try {
        const parsed = parseFloat(tx.amount);
        // If amount > 1000, assume it's in atomic units (6 decimals for USDC)
        amount = parsed > 1000 ? parsed / 1e6 : parsed;
      } catch {
        amount = 0;
      }

      if (existing) {
        existing.totalAmount += amount;
        existing.transactionCount += 1;
      } else {
        senderMap.set(tx.fromAddress, {
          address: tx.fromAddress,
          network: tx.network,
          totalAmount: amount,
          transactionCount: 1,
        });
      }
    }

    // Convert to array and sort by total amount (descending)
    return Array.from(senderMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, limit);
  }, [transactions, limit]);

  if (leaderboard.length === 0) {
    return null; // Don't show the card if there are no senders to display
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-4 h-4" />
          Top Senders
        </CardTitle>
        <CardDescription>Addresses with the highest total transaction volume</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground w-12">#</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Sender Address</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Transactions</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Volume</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((sender, index) => {
                const explorerUrl = getAddressExplorerUrl(sender.address, sender.network);
                const displayAddress = formatAddress(sender.address);

                return (
                  <tr
                    key={sender.address}
                    className="border-t border-border hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-muted-foreground">
                      {index + 1}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">
                      {explorerUrl ? (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center gap-1"
                        >
                          {displayAddress}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span>{displayAddress}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-muted-foreground">
                      {sender.transactionCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-medium">
                      ${sender.totalAmount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
