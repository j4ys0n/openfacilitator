'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, type Facilitator } from '@/lib/api';
import { useAuth } from '@/components/auth/auth-provider';
import { Navbar } from '@/components/navbar';
import { useToast } from '@/hooks/use-toast';
import { useDomainStatus } from '@/hooks/use-domain-status';
import { FacilitatorCard } from '@/components/facilitator-card';
import { CreateFacilitatorCard } from '@/components/create-facilitator-card';
import { CreateFacilitatorModal } from '@/components/create-facilitator-modal';
import { BillingSection } from '@/components/billing-section';
import { EmptyState } from '@/components/empty-state';

const FREE_ENDPOINT = 'https://pay.openfacilitator.io';

// Free Endpoint Section
function FreeEndpointSection() {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(FREE_ENDPOINT);
    setCopied(true);
    toast({
      title: 'Copied!',
      description: 'Free endpoint URL copied to clipboard',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-2 border-dashed border-border rounded-lg p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-1">Don't need your own domain?</p>
          <p className="font-mono">{FREE_ENDPOINT}</p>
          <p className="text-sm text-muted-foreground">Just use ours · No setup needed</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="w-4 h-4 mr-2" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-2" />
              Copy URL
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// DNS Setup Dialog
function DnsSetupDialog({
  open,
  onOpenChange,
  facilitator,
  onDnsVerified,
  onFacilitatorUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilitator: Facilitator | null;
  onDnsVerified?: () => void;
  onFacilitatorUpdated?: (facilitator: Facilitator) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const domain = facilitator?.customDomain || '';
  const subdomain = domain.split('.')[0] || 'x402';

  const { cnameValue, cnameName: apiCnameName, cnameType, isActive, isLoading: isDnsLoading } = useDomainStatus(
    facilitator?.id,
    !!facilitator?.customDomain && open
  );
  const cnameName = apiCnameName || subdomain;

  // If domain is already active, close dialog and redirect
  useEffect(() => {
    if (open && isActive && facilitator) {
      onOpenChange(false);
      onDnsVerified?.();
    }
  }, [open, isActive, facilitator, onOpenChange, onDnsVerified]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cnameValue);
    setCopied(true);
    toast({ title: 'Copied!', description: 'CNAME value copied to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCheckDns = async () => {
    if (!facilitator) return;

    setIsChecking(true);
    try {
      const status = await api.getDomainStatus(facilitator.id);
      queryClient.invalidateQueries({ queryKey: ['domainStatus', facilitator.id] });
      queryClient.invalidateQueries({ queryKey: ['facilitators'] });

      if (status.status === 'active') {
        toast({ title: 'DNS Verified!', description: 'Your domain is now active.' });
        onOpenChange(false);
        onDnsVerified?.();
      } else if (status.status === 'pending') {
        toast({
          title: 'DNS Propagating',
          description: 'Your DNS is configured but still propagating. This can take up to 48 hours.',
        });
      } else {
        toast({
          title: 'DNS Not Configured',
          description: 'Please add the CNAME record and try again.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Check Failed',
        description: 'Could not verify DNS status. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const updateDomainMutation = useMutation({
    mutationFn: async (newDomain: string) => {
      if (!facilitator) throw new Error('No facilitator');

      if (facilitator.customDomain) {
        try {
          await api.removeDomain(facilitator.id);
        } catch {
          // Continue even if removal fails
        }
      }

      const updated = await api.updateFacilitator(facilitator.id, { customDomain: newDomain });
      await api.setupDomain(facilitator.id);
      return updated;
    },
    onSuccess: (updatedFacilitator) => {
      queryClient.invalidateQueries({ queryKey: ['facilitators'] });
      queryClient.invalidateQueries({ queryKey: ['domainStatus', facilitator?.id] });
      toast({ title: 'Domain updated', description: 'Your domain has been changed. Update your DNS records.' });
      setIsEditing(false);
      onFacilitatorUpdated?.(updatedFacilitator);
    },
    onError: (error) => {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Could not update domain.',
        variant: 'destructive',
      });
    },
  });

  const handleStartEdit = () => {
    setEditValue(domain);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === domain) {
      setIsEditing(false);
      return;
    }
    updateDomainMutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setIsEditing(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Almost there!</DialogTitle>
          <DialogDescription className="text-base">
            Add this DNS record to activate your domain
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 py-4">
          {isEditing ? (
            <>
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                onKeyDown={handleKeyDown}
                className="font-mono flex-1"
                autoFocus
              />
              <Button
                className="w-20"
                onClick={handleSave}
                disabled={updateDomainMutation.isPending}
              >
                {updateDomainMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <div className="flex-1 px-3 py-2 rounded-md bg-muted font-mono text-sm">
                {domain}
              </div>
              <Button className="w-20" variant="outline" onClick={handleStartEdit}>
                Edit
              </Button>
            </>
          )}
        </div>

        {isDnsLoading ? (
          <div className="rounded-xl border border-border bg-muted/30 p-5 flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Loading DNS configuration...
            </p>
          </div>
        ) : cnameValue ? (
          <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-4">
            <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
              <span className="text-muted-foreground">Type:</span>
              <span className="font-mono font-medium">{cnameType}</span>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
              <span className="text-muted-foreground">Name:</span>
              <span className="font-mono font-medium">{cnameName || '@'}</span>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
              <span className="text-muted-foreground">Value:</span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium truncate">{cnameValue}</span>
                <button
                  onClick={handleCopy}
                  className="p-1 hover:bg-muted rounded transition-colors shrink-0"
                  title="Copy value"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted/30 p-5">
            <p className="text-sm text-muted-foreground">
              Unable to load DNS configuration. Please try again later.
            </p>
          </div>
        )}

        <div className="space-y-4 pt-4">
          <Button
            className="w-full"
            size="lg"
            onClick={handleCheckDns}
            disabled={isChecking}
          >
            {isChecking ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Check DNS Status
              </>
            )}
          </Button>

          <div className="text-center">
            <Link
              href="/docs/dns-setup"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
              Need help? View DNS setup guide
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [dnsSetupOpen, setDnsSetupOpen] = useState(false);
  const [dnsSetupFacilitator, setDnsSetupFacilitator] = useState<Facilitator | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/signin');
    }
  }, [authLoading, isAuthenticated, router]);

  const { data: facilitators, isLoading } = useQuery({
    queryKey: ['facilitators'],
    queryFn: () => api.getFacilitators(),
    enabled: isAuthenticated,
  });

  const { data: subscription } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.getSubscriptionStatus(),
    enabled: isAuthenticated,
  });

  const { data: billingWallet } = useQuery({
    queryKey: ['billingWallet'],
    queryFn: () => api.getBillingWallet(),
    enabled: isAuthenticated,
  });

  const handleCreateSuccess = (facilitator: Facilitator) => {
    queryClient.invalidateQueries({ queryKey: ['facilitators'] });
    setDnsSetupFacilitator(facilitator);
    setDnsSetupOpen(true);
  };

  const handleDnsVerified = () => {
    if (dnsSetupFacilitator) {
      router.push(`/dashboard/${dnsSetupFacilitator.id}`);
    }
  };

  const handleManageClick = (facilitator: Facilitator) => {
    // If no custom domain, just go to dashboard
    if (!facilitator.customDomain) {
      router.push(`/dashboard/${facilitator.id}`);
      return;
    }

    // Open DNS setup dialog - it will check status and either show setup or redirect
    setDnsSetupFacilitator(facilitator);
    setDnsSetupOpen(true);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const hasFacilitators = facilitators && facilitators.length > 0;
  const walletBalance = billingWallet?.hasWallet ? billingWallet.balance : '0.00';

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 pt-24 pb-20">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Your Facilitators</h1>
            {hasFacilitators && (
              <p className="text-muted-foreground mt-1">
                {facilitators.length} facilitator{facilitators.length !== 1 ? 's' : ''} · ${facilitators.length * 5}/month
              </p>
            )}
          </div>
          {hasFacilitators && (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Facilitator
            </Button>
          )}
        </div>

        {/* Loading State */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-border rounded-lg p-5 animate-pulse">
                <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2 mb-4" />
                <div className="h-4 bg-muted rounded w-2/3 mb-4" />
                <div className="h-8 bg-muted rounded w-1/3 mt-4" />
              </div>
            ))}
          </div>
        ) : hasFacilitators ? (
          /* Facilitator Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {facilitators.map((facilitator) => (
              <FacilitatorCard
                key={facilitator.id}
                facilitator={facilitator}
                onManageClick={() => handleManageClick(facilitator)}
              />
            ))}
            <CreateFacilitatorCard onClick={() => setIsCreateOpen(true)} />
          </div>
        ) : (
          /* Empty State */
          <div className="mb-12">
            <EmptyState onCreateClick={() => setIsCreateOpen(true)} />
          </div>
        )}

        {/* Shared Facilitator Option */}
        <div className="mb-12">
          <FreeEndpointSection />
        </div>

        {/* Billing Section (only show if has facilitators) */}
        {hasFacilitators && (
          <div className="mb-12">
            <BillingSection
              facilitators={facilitators}
              walletBalance={walletBalance}
              subscription={subscription}
            />
          </div>
        )}

        {/* Docs Link */}
        <div className="text-center">
          <Link
            href="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View Documentation →
          </Link>
        </div>
      </main>

      {/* Create Facilitator Modal */}
      <CreateFacilitatorModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={handleCreateSuccess}
        walletBalance={walletBalance}
      />

      {/* DNS Setup Dialog */}
      <DnsSetupDialog
        open={dnsSetupOpen}
        onOpenChange={setDnsSetupOpen}
        facilitator={dnsSetupFacilitator}
        onDnsVerified={handleDnsVerified}
        onFacilitatorUpdated={setDnsSetupFacilitator}
      />

    </div>
  );
}
