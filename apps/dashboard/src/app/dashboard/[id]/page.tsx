'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  Download,
  Activity,
  Globe,
  Key,
  Settings,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Wallet,
  Plus,
  Trash2,
  Import,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { api, type Transaction } from '@/lib/api';
import { formatDate, formatAddress } from '@/lib/utils';

const networkNames: Record<string | number, string> = {
  8453: 'Base',
  84532: 'Base Sepolia',
  1: 'Ethereum',
  11155111: 'Sepolia',
  'solana': 'Solana',
  'solana-devnet': 'Solana Devnet',
};

export default function FacilitatorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedDns, setCopiedDns] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedSolanaAddress, setCopiedSolanaAddress] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportWalletOpen, setIsImportWalletOpen] = useState(false);
  const [isImportSolanaWalletOpen, setIsImportSolanaWalletOpen] = useState(false);
  const [isChangeDomainOpen, setIsChangeDomainOpen] = useState(false);
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [importSolanaPrivateKey, setImportSolanaPrivateKey] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const queryClient = useQueryClient();

  const { data: facilitator, isLoading } = useQuery({
    queryKey: ['facilitator', id],
    queryFn: () => api.getFacilitator(id),
  });

  const { data: domainStatus, refetch: refetchDomainStatus } = useQuery({
    queryKey: ['domainStatus', id],
    queryFn: () => api.getDomainStatus(id),
    enabled: !!facilitator?.customDomain,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 10000 : false), // Poll every 10s if pending
  });

  const setupDomainMutation = useMutation({
    mutationFn: () => api.setupDomain(id),
    onSuccess: () => {
      refetchDomainStatus();
    },
  });

  const updateDomainMutation = useMutation({
    mutationFn: (domain: string | null) => api.updateFacilitator(id, { customDomain: domain }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facilitator', id] });
      queryClient.invalidateQueries({ queryKey: ['domainStatus', id] });
      setIsChangeDomainOpen(false);
      setNewDomain('');
    },
  });

  const { data: transactionsData } = useQuery({
    queryKey: ['transactions', id],
    queryFn: () => api.getTransactions(id),
    enabled: !!id,
  });

  const { data: exportConfig, refetch: fetchExport } = useQuery({
    queryKey: ['export', id],
    queryFn: () => api.exportConfig(id),
    enabled: false,
  });

  // Wallet queries and mutations
  const { data: walletInfo, refetch: refetchWallet } = useQuery({
    queryKey: ['wallet', id],
    queryFn: () => api.getWallet(id),
    enabled: !!id,
  });

  const generateWalletMutation = useMutation({
    mutationFn: () => api.generateWallet(id),
    onSuccess: () => {
      refetchWallet();
      queryClient.invalidateQueries({ queryKey: ['wallet', id] });
    },
  });

  const importWalletMutation = useMutation({
    mutationFn: (privateKey: string) => api.importWallet(id, privateKey),
    onSuccess: () => {
      refetchWallet();
      setIsImportWalletOpen(false);
      setImportPrivateKey('');
      queryClient.invalidateQueries({ queryKey: ['wallet', id] });
    },
  });

  const deleteWalletMutation = useMutation({
    mutationFn: () => api.deleteWallet(id),
    onSuccess: () => {
      refetchWallet();
      queryClient.invalidateQueries({ queryKey: ['wallet', id] });
    },
  });

  // Solana wallet queries and mutations
  const { data: solanaWalletInfo, refetch: refetchSolanaWallet } = useQuery({
    queryKey: ['solanaWallet', id],
    queryFn: () => api.getSolanaWallet(id),
    enabled: !!id,
  });

  const generateSolanaWalletMutation = useMutation({
    mutationFn: () => api.generateSolanaWallet(id),
    onSuccess: () => {
      refetchSolanaWallet();
      queryClient.invalidateQueries({ queryKey: ['solanaWallet', id] });
    },
  });

  const importSolanaWalletMutation = useMutation({
    mutationFn: (privateKey: string) => api.importSolanaWallet(id, privateKey),
    onSuccess: () => {
      refetchSolanaWallet();
      setIsImportSolanaWalletOpen(false);
      setImportSolanaPrivateKey('');
      queryClient.invalidateQueries({ queryKey: ['solanaWallet', id] });
    },
  });

  const deleteSolanaWalletMutation = useMutation({
    mutationFn: () => api.deleteSolanaWallet(id),
    onSuccess: () => {
      refetchSolanaWallet();
      queryClient.invalidateQueries({ queryKey: ['solanaWallet', id] });
    },
  });

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleExport = async () => {
    await fetchExport();
    setIsExportOpen(true);
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!facilitator) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Facilitator not found</h1>
          <Link href="/dashboard" className="text-primary hover:underline">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-xl">OpenFacilitator</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              Dashboard
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{facilitator.name}</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        {/* Facilitator header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl font-bold mb-2">{facilitator.name}</h1>
            <div className="flex items-center gap-2">
              <span className="font-mono text-muted-foreground">{facilitator.url}</span>
              <button
                onClick={() => copyToClipboard(facilitator.url)}
                className="text-muted-foreground hover:text-foreground"
              >
                {copiedUrl ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
              </button>
              <a
                href={facilitator.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Dialog open={isExportOpen} onOpenChange={setIsExportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" onClick={handleExport}>
                  <Download className="w-4 h-4 mr-2" />
                  Export for Self-Host
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Self-Host Configuration</DialogTitle>
                  <DialogDescription>
                    Download the configuration files to run this facilitator on your own infrastructure.
                  </DialogDescription>
                </DialogHeader>
                {exportConfig && (
                  <div className="space-y-4 py-4">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadFile(exportConfig.dockerCompose, 'docker-compose.yml')}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        docker-compose.yml
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadFile(exportConfig.envFile, '.env')}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        .env
                      </Button>
                    </div>
                    <div className="bg-muted rounded-lg p-4">
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {exportConfig.instructions}
                      </pre>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid sm:grid-cols-4 gap-6 mb-10">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Settled</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-bold text-primary">
                ${transactionsData?.stats?.totalAmountSettled ?? '0.00'}
              </span>
              <p className="text-xs text-muted-foreground mt-1">USDC</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Verifications</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-bold">
                {transactionsData?.stats?.totalVerifications ?? 0}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Settlements</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-bold">
                {transactionsData?.stats?.totalSettlements ?? 0}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Networks</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-bold">{facilitator.supportedChains.length}</span>
            </CardContent>
          </Card>
        </div>

        {/* Configuration & Transactions */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Configuration */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-muted-foreground">Subdomain</Label>
                  <p className="font-mono">{facilitator.subdomain}.openfacilitator.io</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Custom Domain</Label>
                  {facilitator.customDomain ? (
                    <div className="flex items-center gap-2">
                      <p className="font-mono">{facilitator.customDomain}</p>
                      {domainStatus?.status === 'active' && (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      )}
                      {domainStatus?.status === 'pending' && (
                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Not configured</p>
                  )}
                  <Dialog open={isChangeDomainOpen} onOpenChange={setIsChangeDomainOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="mt-2">
                        {facilitator.customDomain ? 'Change Domain' : 'Add Custom Domain'}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{facilitator.customDomain ? 'Change Custom Domain' : 'Add Custom Domain'}</DialogTitle>
                        <DialogDescription>
                          {facilitator.customDomain 
                            ? `Current domain: ${facilitator.customDomain}. Enter a new domain to replace it.`
                            : 'Enter your custom domain to use instead of the default subdomain.'
                          }
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="newDomain">Domain</Label>
                          <Input
                            id="newDomain"
                            placeholder="pay.yourdomain.com"
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                          />
                        </div>
                        <div className="rounded-lg bg-muted/50 p-4 text-sm">
                          <div className="font-medium mb-2">DNS Setup Required</div>
                          <div className="text-muted-foreground space-y-1">
                            <p>After saving, add a CNAME record pointing to:</p>
                            <code className="block bg-background px-2 py-1 rounded text-xs font-mono mt-1">
                              api.openfacilitator.io
                            </code>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-between">
                        {facilitator.customDomain && (
                          <Button
                            variant="destructive"
                            onClick={() => {
                              if (confirm('Remove custom domain? The subdomain will still work.')) {
                                updateDomainMutation.mutate(null);
                              }
                            }}
                            disabled={updateDomainMutation.isPending}
                          >
                            Remove Domain
                          </Button>
                        )}
                        <div className="flex gap-2 ml-auto">
                          <Button variant="outline" onClick={() => setIsChangeDomainOpen(false)}>
                            Cancel
                          </Button>
                          <Button
                            onClick={() => updateDomainMutation.mutate(newDomain)}
                            disabled={!newDomain || updateDomainMutation.isPending}
                          >
                            {updateDomainMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              'Save Domain'
                            )}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <div>
                  <Label className="text-muted-foreground">Owner Address</Label>
                  <p className="font-mono text-sm">{formatAddress(facilitator.ownerAddress)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Created</Label>
                  <p>{formatDate(facilitator.createdAt)}</p>
                </div>
              </CardContent>
            </Card>

            {/* Domain Setup Card - only show if custom domain is configured */}
            {facilitator.customDomain && (
              <Card className={domainStatus?.status === 'active' ? 'border-green-500/50' : domainStatus?.status === 'pending' ? 'border-yellow-500/50' : ''}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Domain Setup
                    {domainStatus?.status === 'active' && (
                      <span className="text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded-full">Active</span>
                    )}
                    {domainStatus?.status === 'pending' && (
                      <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded-full">Pending DNS</span>
                    )}
                  </CardTitle>
                  <CardDescription>Configure DNS for your custom domain</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {domainStatus?.status === 'active' ? (
                    <div className="flex items-center gap-2 text-green-500">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Domain is active and SSL is provisioned!</span>
                    </div>
                  ) : (
                    <>
                      <div className="bg-muted p-4 rounded-lg space-y-3">
                        <p className="text-sm font-medium">Add this DNS record:</p>
                        {domainStatus?.dnsRecords?.map((record, i) => (
                          <div key={i} className="font-mono text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Type:</span>
                              <span>{record.type}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Name:</span>
                              <span>{record.name.split('.')[0] || '@'}</span>
                            </div>
                            <div className="flex justify-between items-center gap-2">
                              <span className="text-muted-foreground">Value:</span>
                              <div className="flex items-center gap-1">
                                <span className="truncate max-w-[150px]">{record.value}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => {
                                    navigator.clipboard.writeText(record.value);
                                    setCopiedDns(true);
                                    setTimeout(() => setCopiedDns(false), 2000);
                                  }}
                                >
                                  {copiedDns ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )) || (
                          <div className="font-mono text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Type:</span>
                              <span>CNAME</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Name:</span>
                              <span>{facilitator.customDomain.split('.')[0]}</span>
                            </div>
                            <div className="flex justify-between items-center gap-2">
                              <span className="text-muted-foreground">Value:</span>
                              <div className="flex items-center gap-1">
                                <span>api.openfacilitator.io</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => {
                                    navigator.clipboard.writeText('api.openfacilitator.io');
                                    setCopiedDns(true);
                                    setTimeout(() => setCopiedDns(false), 2000);
                                  }}
                                >
                                  {copiedDns ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        {domainStatus?.status === 'not_added' && domainStatus.railwayConfigured && (
                          <Button 
                            onClick={() => setupDomainMutation.mutate()}
                            disabled={setupDomainMutation.isPending}
                            className="flex-1"
                          >
                            {setupDomainMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Setting up...
                              </>
                            ) : (
                              'Setup Domain'
                            )}
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          onClick={() => refetchDomainStatus()}
                          className="flex-1"
                        >
                          Verify DNS
                        </Button>
                      </div>

                      {domainStatus?.status === 'pending' && (
                        <p className="text-xs text-muted-foreground">
                          DNS changes can take up to 48 hours to propagate. We&apos;ll check automatically.
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Supported Networks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {facilitator.supportedChains.map((chainId) => (
                    <div
                      key={chainId}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted"
                    >
                      <span>{networkNames[chainId] || `Chain ${chainId}`}</span>
                      <span className="text-xs text-muted-foreground font-mono">{chainId}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* EVM Wallet Card (Base/Ethereum) */}
            <Card className={walletInfo?.hasWallet ? 'border-green-500/50' : 'border-yellow-500/50'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  EVM Wallet
                  <span className="text-xs text-muted-foreground">(Base)</span>
                  {walletInfo?.hasWallet ? (
                    <span className="text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded-full">Active</span>
                  ) : (
                    <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded-full">Not Set</span>
                  )}
                </CardTitle>
                <CardDescription>
                  {walletInfo?.hasWallet 
                    ? 'Submits Base & Ethereum settlements'
                    : 'Required for Base payments'
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {walletInfo?.hasWallet ? (
                  <>
                    <div>
                      <Label className="text-muted-foreground text-xs">Address</Label>
                      <div className="flex items-center gap-2 font-mono text-sm bg-muted p-2 rounded">
                        <span className="truncate">{walletInfo.address}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(walletInfo.address || '');
                            setCopiedAddress(true);
                            setTimeout(() => setCopiedAddress(false), 2000);
                          }}
                        >
                          {copiedAddress ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                    
                    <div>
                      <Label className="text-muted-foreground text-xs">Gas Balances</Label>
                      <div className="space-y-1 mt-1">
                        {Object.entries(walletInfo.balances).length > 0 ? (
                          Object.entries(walletInfo.balances).map(([chainId, balance]) => (
                            <div key={chainId} className="flex justify-between text-sm bg-muted p-2 rounded">
                              <span>{networkNames[chainId] || `Chain ${chainId}`}</span>
                              <span className="font-mono">{balance.formatted} ETH</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">Loading balances...</p>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-2">
                        Fund this address with ETH for gas fees on each network.
                      </p>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (confirm('Are you sure? This will remove the wallet and stop settlements.')) {
                            deleteWalletMutation.mutate();
                          }
                        }}
                        disabled={deleteWalletMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove Wallet
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      A wallet is required to submit settlement transactions. You can generate a new wallet or import an existing one.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => generateWalletMutation.mutate()}
                        disabled={generateWalletMutation.isPending}
                        className="flex-1"
                      >
                        {generateWalletMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4 mr-2" />
                        )}
                        Generate Wallet
                      </Button>
                      <Dialog open={isImportWalletOpen} onOpenChange={setIsImportWalletOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="flex-1">
                            <Import className="w-4 h-4 mr-2" />
                            Import
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Import Private Key</DialogTitle>
                            <DialogDescription>
                              Enter your existing private key. It will be encrypted and stored securely.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div>
                              <Label htmlFor="privateKey">Private Key</Label>
                              <Input
                                id="privateKey"
                                type="password"
                                placeholder="0x..."
                                value={importPrivateKey}
                                onChange={(e) => setImportPrivateKey(e.target.value)}
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Must be 0x-prefixed 64 hex characters
                              </p>
                            </div>
                            <Button
                              onClick={() => importWalletMutation.mutate(importPrivateKey)}
                              disabled={importWalletMutation.isPending || !importPrivateKey}
                              className="w-full"
                            >
                              {importWalletMutation.isPending ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : null}
                              Import Wallet
                            </Button>
                            {importWalletMutation.isError && (
                              <p className="text-sm text-destructive">
                                {importWalletMutation.error?.message || 'Failed to import wallet'}
                              </p>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    {generateWalletMutation.isError && (
                      <p className="text-sm text-destructive">
                        {generateWalletMutation.error?.message || 'Failed to generate wallet'}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Solana Wallet Card */}
            <Card className={solanaWalletInfo?.hasWallet ? 'border-green-500/50' : 'border-yellow-500/50'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  Solana Wallet
                  {solanaWalletInfo?.hasWallet ? (
                    <span className="text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded-full">Active</span>
                  ) : (
                    <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded-full">Not Set</span>
                  )}
                </CardTitle>
                <CardDescription>
                  {solanaWalletInfo?.hasWallet 
                    ? 'Submits Solana settlements'
                    : 'Required for Solana payments'
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {solanaWalletInfo?.hasWallet ? (
                  <>
                    <div>
                      <Label className="text-muted-foreground text-xs">Address</Label>
                      <div className="flex items-center gap-2 font-mono text-sm bg-muted p-2 rounded">
                        <span className="truncate">{solanaWalletInfo.address}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(solanaWalletInfo.address || '');
                            setCopiedSolanaAddress(true);
                            setTimeout(() => setCopiedSolanaAddress(false), 2000);
                          }}
                        >
                          {copiedSolanaAddress ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                    
                    {solanaWalletInfo.balance && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Balance</Label>
                        <div className="flex justify-between text-sm bg-muted p-2 rounded">
                          <span>Solana</span>
                          <span className="font-mono">{solanaWalletInfo.balance.sol} SOL</span>
                        </div>
                      </div>
                    )}

                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-2">
                        Fund this address with SOL for transaction fees.
                      </p>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (confirm('Are you sure? This will remove the Solana wallet and stop Solana settlements.')) {
                            deleteSolanaWalletMutation.mutate();
                          }
                        }}
                        disabled={deleteSolanaWalletMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove Wallet
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      A Solana wallet is required for Solana payments. Generate or import one.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => generateSolanaWalletMutation.mutate()}
                        disabled={generateSolanaWalletMutation.isPending}
                        className="flex-1"
                      >
                        {generateSolanaWalletMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4 mr-2" />
                        )}
                        Generate
                      </Button>
                      <Dialog open={isImportSolanaWalletOpen} onOpenChange={setIsImportSolanaWalletOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="flex-1">
                            <Import className="w-4 h-4 mr-2" />
                            Import
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Import Solana Private Key</DialogTitle>
                            <DialogDescription>
                              Enter your Solana private key (base58 encoded). It will be encrypted and stored securely.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div>
                              <Label htmlFor="solanaPrivateKey">Private Key</Label>
                              <Input
                                id="solanaPrivateKey"
                                type="password"
                                placeholder="base58 encoded key..."
                                value={importSolanaPrivateKey}
                                onChange={(e) => setImportSolanaPrivateKey(e.target.value)}
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                64-byte base58-encoded Solana keypair
                              </p>
                            </div>
                            <Button
                              onClick={() => importSolanaWalletMutation.mutate(importSolanaPrivateKey)}
                              disabled={importSolanaWalletMutation.isPending || !importSolanaPrivateKey}
                              className="w-full"
                            >
                              {importSolanaWalletMutation.isPending ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : null}
                              Import Wallet
                            </Button>
                            {importSolanaWalletMutation.isError && (
                              <p className="text-sm text-destructive">
                                {importSolanaWalletMutation.error?.message || 'Failed to import Solana wallet'}
                              </p>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    {generateSolanaWalletMutation.isError && (
                      <p className="text-sm text-destructive">
                        {generateSolanaWalletMutation.error?.message || 'Failed to generate Solana wallet'}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  API Endpoints
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-muted-foreground text-xs">Verify</Label>
                  <p className="font-mono text-xs bg-muted p-2 rounded">POST {facilitator.url}/verify</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Settle</Label>
                  <p className="font-mono text-xs bg-muted p-2 rounded">POST {facilitator.url}/settle</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Supported</Label>
                  <p className="font-mono text-xs bg-muted p-2 rounded">GET {facilitator.url}/supported</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Transactions */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Recent Transactions
              </CardTitle>
              <CardDescription>Payment verifications and settlements</CardDescription>
            </CardHeader>
            <CardContent>
              {!transactionsData?.transactions.length ? (
                <div className="text-center py-12">
                  <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No transactions yet</p>
                  <p className="text-sm text-muted-foreground">
                    Transactions will appear here when payments are processed.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactionsData.transactions.map((tx: Transaction) => {
                    // Build explorer URL for transaction hash
                    const getExplorerUrl = () => {
                      if (!tx.transactionHash) return null;
                      if (tx.network === 'solana' || tx.network === 'solana-mainnet') {
                        return `https://solscan.io/tx/${tx.transactionHash}`;
                      }
                      if (tx.network === 'solana-devnet') {
                        return `https://solscan.io/tx/${tx.transactionHash}?cluster=devnet`;
                      }
                      if (tx.network === '8453' || tx.network === 'base') {
                        return `https://basescan.org/tx/${tx.transactionHash}`;
                      }
                      if (tx.network === '84532' || tx.network === 'base-sepolia') {
                        return `https://sepolia.basescan.org/tx/${tx.transactionHash}`;
                      }
                      if (tx.network === '1' || tx.network === 'ethereum') {
                        return `https://etherscan.io/tx/${tx.transactionHash}`;
                      }
                      return null;
                    };
                    const explorerUrl = getExplorerUrl();
                    
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between p-4 rounded-lg bg-muted"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              tx.type === 'verify' ? 'bg-blue-500/20' : 'bg-primary/20'
                            }`}
                          >
                            {tx.type === 'verify' ? (
                              <Check className="w-4 h-4 text-blue-500" />
                            ) : (
                              <ShieldCheck className="w-4 h-4 text-primary" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium capitalize">{tx.type}</p>
                              {tx.type === 'settle' && explorerUrl && (
                                <a
                                  href={explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-primary"
                                  title="View on explorer"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {formatAddress(tx.fromAddress)} → {formatAddress(tx.toAddress)}
                            </p>
                            {tx.type === 'settle' && tx.transactionHash && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {formatAddress(tx.transactionHash)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono">{tx.amount}</p>
                          <p className="text-sm text-muted-foreground">{formatDate(tx.createdAt)}</p>
                        </div>
                        <div
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            tx.status === 'success'
                              ? 'bg-primary/20 text-primary'
                              : tx.status === 'pending'
                                ? 'bg-yellow-500/20 text-yellow-500'
                                : 'bg-destructive/20 text-destructive'
                          }`}
                        >
                          {tx.status}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

