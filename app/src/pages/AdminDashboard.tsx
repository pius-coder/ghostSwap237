import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  Clipboard,
  CreditCard,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  MessagesSquare,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { ROUTES } from '@/lib/routes';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AppButton as Button } from '@/components/app';

type ProLicense = {
  id: string;
  user_id: string;
  status: 'pending' | 'active' | 'revoked';
  credits_per_second: number;
  code_last4: string;
  redeemed_at?: string | null;
  updated_at?: string;
  user?: { email?: string; name?: string } | null;
};

type Client = {
  id: string;
  email: string;
  name?: string;
  is_admin?: boolean;
  credits: number;
  proLicense?: ProLicense | null;
};

type Payment = {
  id: string;
  user_id: string;
  provider: 'fapshi' | 'chariow' | 'website' | 'legacy';
  gross_amount: number;
  fee_amount?: number | null;
  net_amount?: number | null;
  currency?: string;
  credits_purchased: number;
  status: string;
  fulfilment_status: string;
  provider_status?: string;
  provider_reference?: string;
  created_at: string;
  user?: { email?: string; name?: string } | null;
};

type LedgerRow = {
  id: string; entry_type: string; credits_delta: number; balance_before: number; balance_after: number;
  reason?: string; created_at: string; user?: { email?: string } | null;
};

type NotificationRow = {
  id: string; event_type: string; severity: string; channel: string; destination: string;
  status: string; attempts: number; last_error?: string | null; created_at: string;
};
type NotificationRecipient = { id: string; channel: string; destination: string; enabled: boolean; minimum_severity: string };

type SupportThread = {
  id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  whatsapp_number?: string | null;
  last_message_at: string;
  last_client_message_at?: string | null;
  unread?: boolean;
  user?: { email?: string; name?: string } | null;
};

type SupportMessage = {
  id: string;
  thread_id: string;
  sender_role: 'client' | 'admin' | 'system';
  body: string;
  whatsapp_delivery_status: string;
  created_at: string;
};

type UsageRow = {
  id: string;
  provider: string;
  model?: string;
  seconds_used: number;
  credits_used: number;
  credits_per_second: number;
  providerCostUsd?: number | null;
  start_time: string;
  user?: { email?: string; name?: string } | null;
};

type AuditRow = {
  id: string;
  action: string;
  reason: string;
  actor_user_id: string;
  target_user_id?: string | null;
  created_at: string;
};

type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price_usd: number;
  price_xaf: number;
  is_active: boolean;
  chariow_product_id?: string | null;
  chariow_enabled?: boolean;
};

type Overview = {
  totalUsers: number;
  totalCredits: number;
  activeProLicenses: number;
  pendingProLicenses: number;
  pendingPayments: number;
  paidNotFulfilled: number;
  failedNotifications: number;
  cashByCurrency: Record<string, { gross: number; fees: number; net: number; refunded: number }>;
  creditMovements: Record<string, number>;
  usageByProvider: Record<string, { sessions: number; seconds: number; credits: number; providerCostUsd: number }>;
};

type Mutation =
  | { kind: 'credits'; client: Client }
  | { kind: 'create-license'; client: Client }
  | { kind: 'license'; license: ProLicense; action: 'set_rate' | 'revoke' | 'reactivate' }
  | { kind: 'package'; package?: CreditPackage };

const EMPTY_OVERVIEW: Overview = {
  totalUsers: 0,
  totalCredits: 0,
  activeProLicenses: 0,
  pendingProLicenses: 0,
  pendingPayments: 0,
  paidNotFulfilled: 0,
  failedNotifications: 0,
  cashByCurrency: {},
  creditMovements: {},
  usageByProvider: {},
};

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Admin request failed.');
  return body as T;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${safe % 60}s`;
}

function licenseTone(status?: string) {
  if (status === 'active') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
  if (status === 'pending') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-red-500/40 bg-red-500/10 text-red-400';
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [clients, setClients] = useState<Client[]>([]);
  const [licenses, setLicenses] = useState<ProLicense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationRecipients, setNotificationRecipients] = useState<NotificationRecipient[]>([]);
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  const [supportThread, setSupportThread] = useState<SupportThread | null>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [supportReply, setSupportReply] = useState('');
  const [supportReason, setSupportReason] = useState('Mise à jour de la conversation support');
  const [supportNotifyWhatsApp, setSupportNotifyWhatsApp] = useState(true);
  const [supportFilter, setSupportFilter] = useState('active');
  const [supportBusy, setSupportBusy] = useState(false);
  const [recipientChannel, setRecipientChannel] = useState('email');
  const [recipientDestination, setRecipientDestination] = useState('');
  const [recipientReason, setRecipientReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [query, setQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('pending');
  const [mutation, setMutation] = useState<Mutation | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('80');
  const [packageName, setPackageName] = useState('');
  const [packageCredits, setPackageCredits] = useState('');
  const [packageUsd, setPackageUsd] = useState('');
  const [packageXaf, setPackageXaf] = useState('');
  const [packageChariowProduct, setPackageChariowProduct] = useState('');
  const [packageChariowEnabled, setPackageChariowEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);

  const loadData = useCallback(async (usagePeriod = period) => {
    setLoading(true);
    try {
      const [overviewData, clientData, licenseData, paymentData, usageData, auditData, packageData, ledgerData, notificationData, supportData] = await Promise.all([
        adminRequest<Overview>('/admin?action=overview'),
        adminRequest<{ clients: Client[] }>('/admin?action=clients'),
        adminRequest<{ licenses: ProLicense[] }>('/admin?action=licenses'),
        adminRequest<{ rows: Payment[] }>('/admin?action=payments'),
        adminRequest<{ rows: UsageRow[] }>(`/admin?action=usage&period=${usagePeriod}`),
        adminRequest<{ audit: AuditRow[] }>('/admin?action=audit'),
        adminRequest<{ packages: CreditPackage[] }>('/admin?action=packages'),
        adminRequest<{ rows: LedgerRow[] }>('/admin?action=ledger'),
        adminRequest<{ rows: NotificationRow[]; recipients: NotificationRecipient[] }>('/admin?action=notifications'),
        adminRequest<{ threads: SupportThread[]; thread: SupportThread | null; messages: SupportMessage[] }>('/admin?action=support')
          .catch(() => ({ threads: [], thread: null, messages: [] })),
      ]);
      setOverview(overviewData);
      setClients(clientData.clients);
      setLicenses(licenseData.licenses);
      setPayments(paymentData.rows);
      setUsage(usageData.rows);
      setAudit(auditData.audit);
      setPackages(packageData.packages);
      setLedger(ledgerData.rows);
      setNotifications(notificationData.rows);
      setNotificationRecipients(notificationData.recipients);
      setSupportThreads(supportData.threads);
      setSupportThread(supportData.thread);
      setSupportMessages(supportData.messages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load administration data.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadData]);

  if (!user?.isAdmin) return <Navigate to={ROUTES.PROTECTED.DASHBOARD} replace />;

  const openMutation = (next: Mutation) => {
    setMutation(next);
    setReason('');
    setAmount('');
    if (next.kind === 'create-license') setRate('80');
    if (next.kind === 'license') setRate(String(next.license.credits_per_second));
    if (next.kind === 'package') {
      setPackageName(next.package?.name || '');
      setPackageCredits(String(next.package?.credits || ''));
      setPackageUsd(String(next.package?.price_usd || 0));
      setPackageXaf(String(next.package?.price_xaf || 0));
      setPackageChariowProduct(next.package?.chariow_product_id || '');
      setPackageChariowEnabled(next.package?.chariow_enabled === true);
    }
  };

  const submitMutation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mutation) return;
    setBusy(true);
    try {
      let payload: Record<string, unknown>;
      if (mutation.kind === 'credits') {
        payload = { action: 'adjust-credits', userId: mutation.client.id, change: Number(amount), reason };
      } else if (mutation.kind === 'create-license') {
        payload = { action: 'create-license', userId: mutation.client.id, creditsPerSecond: Number(rate), reason };
      } else if (mutation.kind === 'license') {
        payload = {
          action: 'manage-license',
          licenseId: mutation.license.id,
          licenseAction: mutation.action,
          creditsPerSecond: mutation.action === 'set_rate' ? Number(rate) : undefined,
          reason,
        };
      } else {
        payload = {
          action: 'upsert-package',
          packageId: mutation.package?.id,
          name: packageName,
          credits: Number(packageCredits),
          priceUsd: Number(packageUsd),
          priceXaf: Number(packageXaf),
          chariowProductId: packageChariowProduct,
          chariowEnabled: packageChariowEnabled,
          reason,
        };
      }
      const result = await adminRequest<{ code?: string }>('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (result.code) setRevealedCode(result.code);
      toast.success('Administrative change saved and audited.');
      setMutation(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Administrative change failed.');
    } finally {
      setBusy(false);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();

  const saveNotificationRecipient = async () => {
    setBusy(true);
    try {
      await adminRequest('/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'upsert-notification-recipient', channel: recipientChannel,
        destination: recipientDestination, minimumSeverity: 'info', reason: recipientReason,
      }) });
      setRecipientDestination(''); setRecipientReason('');
      toast.success('Notification recipient saved.');
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save recipient.'); }
    finally { setBusy(false); }
  };

  const selectSupportThread = async (threadId: string) => {
    setSupportBusy(true);
    try {
      const data = await adminRequest<{ threads: SupportThread[]; thread: SupportThread | null; messages: SupportMessage[] }>(
        `/admin?action=support&threadId=${encodeURIComponent(threadId)}`,
      );
      setSupportThreads(data.threads);
      setSupportThread(data.thread);
      setSupportMessages(data.messages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the support conversation.');
    } finally {
      setSupportBusy(false);
    }
  };

  const sendSupportReply = async () => {
    const message = supportReply.trim();
    if (!supportThread || !message) return;
    setSupportBusy(true);
    try {
      await adminRequest('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'support-reply',
          threadId: supportThread.id,
          message,
          notifyWhatsApp: supportNotifyWhatsApp,
        }),
      });
      setSupportReply('');
      toast.success('Réponse envoyée au client.');
      await selectSupportThread(supportThread.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the support reply.');
    } finally {
      setSupportBusy(false);
    }
  };

  const updateSupportThread = async (status: SupportThread['status'], priority = supportThread?.priority || 'normal') => {
    if (!supportThread) return;
    setSupportBusy(true);
    try {
      await adminRequest('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'support-update', threadId: supportThread.id, status, priority, reason: supportReason,
        }),
      });
      toast.success('Conversation support mise à jour et auditée.');
      await selectSupportThread(supportThread.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the support conversation.');
    } finally {
      setSupportBusy(false);
    }
  };
  const visibleClients = clients.filter((client) =>
    !normalizedQuery || `${client.name || ''} ${client.email}`.toLowerCase().includes(normalizedQuery));
  const visiblePayments = payments.filter((payment) =>
    (paymentFilter === 'all' || payment.status === paymentFilter)
    && (!normalizedQuery || `${payment.user?.name || ''} ${payment.user?.email || ''} ${payment.provider_reference || ''}`.toLowerCase().includes(normalizedQuery)));
  const visibleSupportThreads = supportThreads.filter((thread) => {
    if (supportFilter === 'active') return thread.status === 'open' || thread.status === 'pending';
    return supportFilter === 'all' || thread.status === supportFilter;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Secure operations</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">Clients, licenses, billing, payments, and immutable audit history.</p>
        </div>
        <Button variant="secondary" onClick={() => void loadData()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Clients" value={overview.totalUsers} icon={<Users className="size-4" />} />
        <Metric title="Wallet credits" value={overview.totalCredits} icon={<CreditCard className="size-4" />} />
        <Metric title="Active PRO" value={overview.activeProLicenses} icon={<ShieldCheck className="size-4" />} />
        <Metric title="Pending payments" value={overview.pendingPayments} icon={<Activity className="size-4" />} />
        <Metric title="Paid, not delivered" value={overview.paidNotFulfilled} icon={<Activity className="size-4" />} />
        <Metric title="Notification failures" value={overview.failedNotifications} icon={<Bell className="size-4" />} />
        <Metric title="Support non lu" value={supportThreads.filter((thread) => thread.unread).length} icon={<MessagesSquare className="size-4" />} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-6 h-auto flex-wrap border border-border/70 bg-muted/45 p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="licenses">Licenses</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="ledger">Credit ledger</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Cash actually received</CardTitle><CardDescription>Gross, fees and net stay separated by currency. Manual credits are excluded.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(overview.cashByCurrency).length ? Object.entries(overview.cashByCurrency).map(([currency, value]) => (
                <div key={currency} className="rounded-lg border border-border/60 px-4 py-3">
                  <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{currency}</span>
                  <strong>{Number(value.net).toLocaleString()} {currency} net</strong>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Gross {value.gross.toLocaleString()} · Fees {value.fees.toLocaleString()} · Refunded/disputed {value.refunded.toLocaleString()}</p>
                </div>
              )) : <Empty label="No confirmed revenue." />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Credit movements</CardTitle><CardDescription>Purchased, manually adjusted and consumed credits never mix with cash.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(overview.creditMovements).length ? Object.entries(overview.creditMovements).map(([type, value]) => (
                <div key={type} className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3"><span>{type.replace('_', ' ')}</span><strong>{value > 0 ? '+' : ''}{value.toLocaleString()} cr</strong></div>
              )) : <Empty label="No ledger movements." />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Usage by provider</CardTitle><CardDescription>Last 30 days, including fal.ai cost.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(overview.usageByProvider).length ? Object.entries(overview.usageByProvider).map(([provider, value]) => (
                <div key={provider} className="rounded-lg border border-border/60 px-4 py-3">
                  <div className="mb-2 flex justify-between"><strong className="uppercase">{provider}</strong><span>{value.sessions} sessions</span></div>
                  <p className="text-xs text-muted-foreground">{formatDuration(value.seconds)} · {value.credits.toLocaleString()} cr · ${value.providerCostUsd.toFixed(2)} provider cost</p>
                </div>
              )) : <Empty label="No session usage." />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clients">
          <DataCard title="Client directory" description="Search accounts and perform audited wallet or license actions." action={<SearchBox value={query} onChange={setQuery} />}>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Credits</TableHead><TableHead>PRO</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {visibleClients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell><strong>{client.name || 'Unnamed'}</strong><p className="text-xs text-muted-foreground">{client.email}</p></TableCell>
                    <TableCell>{client.credits.toLocaleString()} cr</TableCell>
                    <TableCell>{client.proLicense ? <Badge className={licenseTone(client.proLicense.status)}>{client.proLicense.status} · {client.proLicense.credits_per_second} cr/s</Badge> : <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => openMutation({ kind: 'credits', client })}>Adjust credits</Button>{!client.proLicense && <Button size="sm" onClick={() => openMutation({ kind: 'create-license', client })}><Plus className="size-3" /> License</Button>}</div></TableCell>
                  </TableRow>
                ))}
                {!visibleClients.length && <EmptyRow columns={4} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="licenses">
          <DataCard title="PRO licenses" description="Account-bound access, server-authoritative rates, and revocation controls.">
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead>Rate</TableHead><TableHead>Code</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {licenses.map((license) => (
                  <TableRow key={license.id}>
                    <TableCell>{license.user?.name || 'Unnamed'}<p className="text-xs text-muted-foreground">{license.user?.email}</p></TableCell>
                    <TableCell><Badge className={licenseTone(license.status)}>{license.status}</Badge></TableCell>
                    <TableCell>{license.credits_per_second} cr/s</TableCell>
                    <TableCell className="font-mono">•••• {license.code_last4}</TableCell>
                    <TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => openMutation({ kind: 'license', license, action: 'set_rate' })}>Rate</Button>{license.status === 'revoked' ? <Button size="sm" onClick={() => openMutation({ kind: 'license', license, action: 'reactivate' })}>Reactivate</Button> : <Button size="sm" variant="danger" onClick={() => openMutation({ kind: 'license', license, action: 'revoke' })}>Revoke</Button>}</div></TableCell>
                  </TableRow>
                ))}
                {!licenses.length && <EmptyRow columns={5} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="payments">
          <DataCard title="Payment operations" description="Verified provider payments are delivered automatically. Paid-but-undelivered rows are operational incidents." action={<div className="flex gap-2"><SearchBox value={query} onChange={setQuery} /><select className="rounded-md border border-border bg-background px-3 text-sm" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="pending">Pending</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="all">All</option></select></div>}>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Cash</TableHead><TableHead>Provider</TableHead><TableHead>Payment</TableHead><TableHead>Delivery</TableHead></TableRow></TableHeader>
              <TableBody>
                {visiblePayments.map((payment) => (
                  <TableRow key={`${payment.provider}-${payment.id}`}>
                    <TableCell>{payment.user?.name || 'Unknown'}<p className="text-xs text-muted-foreground">{payment.user?.email}</p></TableCell>
                    <TableCell>{Number(payment.gross_amount).toLocaleString()} {payment.currency || 'UNKNOWN'}<p className="text-xs text-muted-foreground">Net {Number(payment.net_amount ?? payment.gross_amount).toLocaleString()} · {payment.credits_purchased || 0} cr</p></TableCell>
                    <TableCell>{payment.provider}<p className="font-mono text-xs text-muted-foreground">{payment.provider_status || payment.provider_reference || 'n/a'}</p></TableCell>
                    <TableCell><Badge variant="outline">{payment.status}</Badge></TableCell>
                    <TableCell><Badge className={payment.fulfilment_status === 'fulfilled' ? licenseTone('active') : licenseTone(payment.fulfilment_status === 'pending' ? 'pending' : 'revoked')}>{payment.fulfilment_status}</Badge></TableCell>
                  </TableRow>
                ))}
                {!visiblePayments.length && <EmptyRow columns={5} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="ledger">
          <DataCard title="Immutable credit ledger" description="Every purchase, manual adjustment and session consumption shows the before/after wallet balance.">
            <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Client</TableHead><TableHead>Origin</TableHead><TableHead>Change</TableHead><TableHead>Balance</TableHead></TableRow></TableHeader><TableBody>
              {ledger.map((row) => <TableRow key={row.id}><TableCell>{new Date(row.created_at).toLocaleString()}</TableCell><TableCell>{row.user?.email || 'Unknown'}</TableCell><TableCell>{row.entry_type.replace('_', ' ')}</TableCell><TableCell className={row.credits_delta > 0 ? 'text-emerald-400' : 'text-red-400'}>{row.credits_delta > 0 ? '+' : ''}{row.credits_delta.toLocaleString()} cr</TableCell><TableCell>{row.balance_before.toLocaleString()} → {row.balance_after.toLocaleString()}</TableCell></TableRow>)}
              {!ledger.length && <EmptyRow columns={5} />}
            </TableBody></Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="support">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Boîte de réception support</CardTitle>
                <CardDescription>Les messages restent dans Henshin. Baileys envoie uniquement les notifications WhatsApp.</CardDescription>
              </div>
              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                value={supportFilter}
                onChange={(event) => setSupportFilter(event.target.value)}
              >
                <option value="active">Actives</option>
                <option value="open">Ouvertes</option>
                <option value="pending">En attente client</option>
                <option value="resolved">Résolues</option>
                <option value="closed">Fermées</option>
                <option value="all">Toutes</option>
              </select>
            </CardHeader>
            <CardContent>
              <div className="grid min-h-[620px] overflow-hidden rounded-xl border border-border/70 lg:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="border-b border-border/70 bg-muted/20 lg:border-b-0 lg:border-r">
                  <div className="max-h-[620px] overflow-y-auto p-2">
                    {visibleSupportThreads.map((thread) => (
                      <button
                        type="button"
                        key={thread.id}
                        onClick={() => void selectSupportThread(thread.id)}
                        className={`mb-1 w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                          supportThread?.id === thread.id
                            ? 'border-violet-500/50 bg-violet-500/10'
                            : 'border-transparent hover:border-border hover:bg-muted/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="truncate text-sm">{thread.user?.name || thread.user?.email || 'Client'}</strong>
                          {thread.unread ? <span className="size-2 shrink-0 rounded-full bg-violet-500" aria-label="Non lu" /> : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{thread.user?.email}</p>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <Badge variant="outline">{thread.status}</Badge>
                          <time>{new Date(thread.last_message_at).toLocaleString()}</time>
                        </div>
                      </button>
                    ))}
                    {!visibleSupportThreads.length ? <Empty label="Aucune conversation support." /> : null}
                  </div>
                </aside>

                <section className="flex min-w-0 flex-col bg-background">
                  {supportThread ? (
                    <>
                      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-4">
                        <div>
                          <h3 className="font-semibold">{supportThread.user?.name || 'Client Henshin'}</h3>
                          <p className="text-xs text-muted-foreground">{supportThread.user?.email}</p>
                          {supportThread.whatsapp_number ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">WhatsApp {supportThread.whatsapp_number}</p> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Priorité support"
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                            value={supportThread.priority}
                            onChange={(event) => void updateSupportThread(supportThread.status, event.target.value as SupportThread['priority'])}
                            disabled={supportBusy || supportReason.trim().length < 3}
                          >
                            <option value="low">Basse</option>
                            <option value="normal">Normale</option>
                            <option value="high">Haute</option>
                            <option value="urgent">Urgente</option>
                          </select>
                          {supportThread.status !== 'resolved' ? (
                            <Button size="sm" variant="secondary" disabled={supportBusy || supportReason.trim().length < 3} onClick={() => void updateSupportThread('resolved')}>Résoudre</Button>
                          ) : (
                            <Button size="sm" variant="secondary" disabled={supportBusy || supportReason.trim().length < 3} onClick={() => void updateSupportThread('open')}>Rouvrir</Button>
                          )}
                          <Button size="sm" variant="ghost" disabled={supportBusy || supportReason.trim().length < 3} onClick={() => void updateSupportThread('closed')}>Fermer</Button>
                        </div>
                      </header>

                      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/10 p-4">
                        {supportMessages.map((message) => (
                          <article
                            key={message.id}
                            className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${
                              message.sender_role === 'admin'
                                ? 'ml-auto rounded-br-md bg-violet-600 text-white'
                                : 'mr-auto rounded-bl-md border border-border bg-background text-foreground'
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{message.body}</p>
                            <div className={`mt-1 flex items-center justify-end gap-2 text-[10px] ${message.sender_role === 'admin' ? 'text-white/65' : 'text-muted-foreground'}`}>
                              <time>{new Date(message.created_at).toLocaleString()}</time>
                              {message.sender_role === 'admin' && message.whatsapp_delivery_status !== 'not_requested'
                                ? <span>WA: {message.whatsapp_delivery_status}</span> : null}
                            </div>
                          </article>
                        ))}
                        {!supportMessages.length ? <Empty label="Cette conversation ne contient aucun message." /> : null}
                      </div>

                      <footer className="space-y-3 border-t border-border/70 p-4">
                        <textarea
                          className="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                          value={supportReply}
                          onChange={(event) => setSupportReply(event.target.value)}
                          maxLength={4000}
                          placeholder="Répondre au client…"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={supportNotifyWhatsApp}
                              onChange={(event) => setSupportNotifyWhatsApp(event.target.checked)}
                              disabled={!supportThread.whatsapp_number}
                            />
                            Notifier aussi sur WhatsApp
                          </label>
                          <Button disabled={supportBusy || !supportReply.trim()} onClick={() => void sendSupportReply()}>
                            <Send className="size-4" /> {supportBusy ? 'Envoi…' : 'Envoyer la réponse'}
                          </Button>
                        </div>
                        <Input
                          value={supportReason}
                          onChange={(event) => setSupportReason(event.target.value)}
                          placeholder="Motif d’audit pour les changements de statut/priorité"
                          minLength={3}
                          maxLength={500}
                        />
                      </footer>
                    </>
                  ) : (
                    <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">
                      Sélectionnez une conversation client.
                    </div>
                  )}
                </section>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <div className="space-y-5">
          <Card><CardHeader><CardTitle>Admin recipients</CardTitle><CardDescription>The delivery gateway routes these destinations to Gmail, WhatsApp or SMS.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2">{notificationRecipients.map((recipient) => <Badge key={recipient.id} variant="outline">{recipient.channel}: {recipient.destination}</Badge>)}</div><div className="grid gap-3 md:grid-cols-4"><select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={recipientChannel} onChange={(event) => setRecipientChannel(event.target.value)}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select><Input value={recipientDestination} onChange={(event) => setRecipientDestination(event.target.value)} placeholder="Address or E.164 number" /><Input value={recipientReason} onChange={(event) => setRecipientReason(event.target.value)} placeholder="Audit reason" /><Button disabled={busy || !recipientDestination || recipientReason.length < 3} onClick={() => void saveNotificationRecipient()}>Add recipient</Button></div></CardContent></Card>
          <DataCard title="Notification delivery" description="Email, WhatsApp and SMS deliveries are deduplicated and retried with exponential backoff.">
            <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Event</TableHead><TableHead>Destination</TableHead><TableHead>Status</TableHead><TableHead>Error</TableHead></TableRow></TableHeader><TableBody>
              {notifications.map((row) => <TableRow key={row.id}><TableCell>{new Date(row.created_at).toLocaleString()}</TableCell><TableCell>{row.event_type}<p className="text-xs text-muted-foreground">{row.severity}</p></TableCell><TableCell>{row.channel}: {row.destination}</TableCell><TableCell><Badge variant="outline">{row.status} · {row.attempts}</Badge></TableCell><TableCell className="max-w-xs truncate text-xs text-red-300">{row.last_error || '—'}</TableCell></TableRow>)}
              {!notifications.length && <EmptyRow columns={5} />}
            </TableBody></Table>
          </DataCard>
          </div>
        </TabsContent>

        <TabsContent value="usage">
          <DataCard title="Session usage" description="Provider usage and fal.ai cost at $0.04 per usable second." action={<select className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={period} onChange={(event) => { const next = event.target.value; setPeriod(next); void loadData(next); }}><option value="today">Today</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="all">All</option></select>}>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Provider</TableHead><TableHead>Duration</TableHead><TableHead>Credits</TableHead><TableHead>Provider cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {usage.map((row) => <TableRow key={row.id}><TableCell>{row.user?.email || 'Unknown'}</TableCell><TableCell className="uppercase">{row.provider}</TableCell><TableCell>{formatDuration(row.seconds_used)}</TableCell><TableCell>{Number(row.credits_used || 0).toLocaleString()} at {row.credits_per_second} cr/s</TableCell><TableCell>{row.providerCostUsd == null ? 'n/a' : `$${row.providerCostUsd.toFixed(2)}`}</TableCell></TableRow>)}
                {!usage.length && <EmptyRow columns={5} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="packages">
          <DataCard title="Credit packages" description="Package changes pass through the authenticated admin API." action={<Button size="sm" onClick={() => openMutation({ kind: 'package' })}><Plus className="size-3" /> Add package</Button>}>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Credits</TableHead><TableHead>USD</TableHead><TableHead>XAF</TableHead><TableHead>Chariow</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {packages.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.credits.toLocaleString()}</TableCell><TableCell>${item.price_usd}</TableCell><TableCell>{item.price_xaf.toLocaleString()} XAF</TableCell><TableCell>{item.chariow_enabled ? <Badge className={licenseTone('active')}>Enabled</Badge> : 'Off'}<p className="font-mono text-xs text-muted-foreground">{item.chariow_product_id || 'not mapped'}</p></TableCell><TableCell className="text-right"><Button size="sm" variant="secondary" onClick={() => openMutation({ kind: 'package', package: item })}>Edit</Button></TableCell></TableRow>)}
                {!packages.length && <EmptyRow columns={6} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="audit">
          <DataCard title="Immutable audit log" description="Sensitive admin actions cannot be edited or deleted.">
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Reason</TableHead><TableHead>Target</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.map((row) => <TableRow key={row.id}><TableCell>{new Date(row.created_at).toLocaleString()}</TableCell><TableCell className="font-mono text-xs">{row.action}</TableCell><TableCell>{row.reason}</TableCell><TableCell className="font-mono text-xs">{row.target_user_id || 'system'}</TableCell></TableRow>)}
                {!audit.length && <EmptyRow columns={4} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>
      </Tabs>

      <Dialog open={mutation !== null} onOpenChange={(open) => !open && setMutation(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{mutationTitle(mutation)}</DialogTitle><DialogDescription>Every change requires a clear operational reason and is associated with your administrator account.</DialogDescription></DialogHeader>
          <form onSubmit={submitMutation} className="space-y-4">
            {mutation?.kind === 'credits' && <Field label="Credit change"><Input type="number" step="1" placeholder="Use a negative value to deduct" value={amount} onChange={(event) => setAmount(event.target.value)} required /></Field>}
            {(mutation?.kind === 'create-license' || (mutation?.kind === 'license' && mutation.action === 'set_rate')) && <Field label="Credits per second"><Input type="number" min="1" step="1" value={rate} onChange={(event) => setRate(event.target.value)} required /><p className="text-xs text-muted-foreground">Standard PRO rate: 80 credits per second. Any account-specific rate must be contractually approved and audited.</p></Field>}
            {mutation?.kind === 'package' && <><Field label="Package name"><Input value={packageName} onChange={(event) => setPackageName(event.target.value)} required /></Field><Field label="Credits"><Input type="number" min="1" step="1" value={packageCredits} onChange={(event) => setPackageCredits(event.target.value)} required /></Field><div className="grid grid-cols-2 gap-3"><Field label="Price USD"><Input type="number" min="0" step="0.01" value={packageUsd} onChange={(event) => setPackageUsd(event.target.value)} required /></Field><Field label="Price XAF"><Input type="number" min="0" step="1" value={packageXaf} onChange={(event) => setPackageXaf(event.target.value)} required /></Field></div><Field label="Chariow product ID"><Input value={packageChariowProduct} onChange={(event) => setPackageChariowProduct(event.target.value)} placeholder="prd_..." /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={packageChariowEnabled} onChange={(event) => setPackageChariowEnabled(event.target.checked)} /> Enable international checkout</label></>}
            <Field label="Audit reason"><Input value={reason} minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Why is this change required?" required /></Field>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setMutation(null)}>Cancel</Button><Button type="submit" variant={mutation?.kind === 'license' && mutation.action === 'revoke' ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Saving...' : 'Confirm change'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revealedCode !== null} onOpenChange={(open) => !open && setRevealedCode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>PRO license generated</DialogTitle><DialogDescription>This full code is shown once. Regeneration replaces it.</DialogDescription></DialogHeader>
          <div className="rounded-lg border border-white/[0.10] bg-white/[0.04] p-4 text-center font-mono text-sm text-foreground">{revealedCode}</div>
          <DialogFooter><Button onClick={() => { if (revealedCode) void navigator.clipboard.writeText(revealedCode); toast.success('License code copied.'); }}><Clipboard className="size-4" /> Copy once</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return <Card className="gap-3"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle><span className="text-foreground/70">{icon}</span></CardHeader><CardContent><p className="text-2xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={Number(value || 0)} /></p></CardContent></Card>;
}

function DataCard({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <Card><CardHeader className="flex flex-row items-start justify-between gap-4"><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>{action}</CardHeader><CardContent><div className="overflow-x-auto rounded-lg border border-border/70">{children}</div></CardContent></Card>;
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="w-52 pl-9" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search" /></div>;
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

function EmptyRow({ columns }: { columns: number }) {
  return <TableRow><TableCell colSpan={columns}><Empty label="No records found." /></TableCell></TableRow>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="text-sm font-medium text-foreground">{label}</span>{children}</label>;
}

function mutationTitle(mutation: Mutation | null) {
  if (!mutation) return 'Administrative change';
  if (mutation.kind === 'credits') return `Adjust credits for ${mutation.client.email}`;
  if (mutation.kind === 'create-license') return `Generate PRO license for ${mutation.client.email}`;
  if (mutation.kind === 'license') return `${mutation.action.replace('_', ' ')} PRO license`;
  return mutation.package ? 'Edit credit package' : 'Create credit package';
}
