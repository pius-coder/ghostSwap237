import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { TextureButton as Button } from '@/components/ui/texture-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Users, CreditCard, Package, Check, X, Activity, Edit2, Plus } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { ROUTES } from '@/lib/routes';

function withTimeout<T>(operation: PromiseLike<T>, label: string, timeoutMs = 12_000): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]);
}

type WalletSummary = { credits?: number };

type AdminUser = {
  id: string;
  name?: string;
  email: string;
  is_admin?: boolean;
  wallets?: WalletSummary | WalletSummary[];
};

type CreditPackage = {
  id: string;
  name?: string;
  credits: number;
  price_usd?: number;
  price_xaf?: number;
};

type PaymentRow = {
  id: string;
  user_id?: string;
  package_id?: string;
  source: 'crypto' | 'website';
  users?: AdminUser;
  credit_packages?: CreditPackage;
  amount: number | string;
  credits?: number;
  currency?: string;
  status: string;
  provider_status?: string;
  reference?: string;
  created_at: string;
};

type RawRow = Record<string, unknown>;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  
  // Stats
  const [stats, setStats] = useState({
    totalUsers: 0,
    pendingPayments: 0,
    totalRevenue: 0
  });

  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isAddCreditOpen, setIsAddCreditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [creditAmount, setCreditAmount] = useState('');

  const [isEditPackageOpen, setIsEditPackageOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [packageName, setPackageName] = useState('');
  const [packageCredits, setPackageCredits] = useState('');
  const [packageUsd, setPackageUsd] = useState('');
  const [packageXaf, setPackageXaf] = useState('');

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      // Load the primary payment table independently so optional dashboard
      // datasets can never hold valid pending payments behind a spinner.
      const paymentsRes = await withTimeout(
        supabase.from('crypto_payments').select('*').order('created_at', { ascending: false }),
        'Pending payments',
      );
      if (paymentsRes.error) throw paymentsRes.error;

      const optionalResults = await Promise.allSettled([
        withTimeout(supabase.from('transactions').select('*').order('created_at', { ascending: false }), 'Website transactions'),
        withTimeout(supabase.from('users').select('*').order('created_at', { ascending: false }), 'Users'),
        withTimeout(supabase.from('credit_packages').select('*').order('sort_order', { ascending: true }).order('credits', { ascending: true }), 'Credit packages'),
      ]);

      optionalResults.forEach(result => {
        if (result.status === 'rejected') console.warn(result.reason);
      });

      const optionalValue = (index: number) => {
        const result = optionalResults[index];
        return result.status === 'fulfilled' ? result.value : { data: [], error: result.reason };
      };
      const websiteTransactionsRes = optionalValue(0);
      const usersRes = optionalValue(1);
      const packagesRes = optionalValue(2);

      const userRows = (usersRes.data || []) as AdminUser[];
      const packageRows = (packagesRes.data || []) as CreditPackage[];
      const usersById = new Map(userRows.map(account => [account.id, account]));
      const packagesById = new Map(packageRows.map(pkg => [pkg.id, pkg]));

      const cryptoPayments: PaymentRow[] = ((paymentsRes.data || []) as RawRow[]).map(payment => ({
        ...payment,
        id: String(payment.id),
        source: 'crypto' as const,
        amount: Number(payment.amount || 0),
        status: String(payment.status || 'pending'),
        created_at: String(payment.created_at || ''),
        users: usersById.get(String(payment.user_id)),
        credit_packages: packagesById.get(String(payment.package_id)),
      } as PaymentRow));
      const websitePayments: PaymentRow[] = ((websiteTransactionsRes.data || []) as RawRow[]).map(transaction => ({
        ...transaction,
        id: String(transaction.id),
        source: 'website' as const,
        users: usersById.get(String(transaction.user_id)),
        currency:
          typeof transaction.metadata === 'object' && transaction.metadata !== null
            ? String((transaction.metadata as RawRow).currency || 'NGN')
            : 'NGN',
        status: transaction.status === 'success' ? 'completed' : transaction.status,
        amount: Number(transaction.amount || 0),
        created_at: String(transaction.created_at || ''),
      } as PaymentRow));
      const combinedPayments = [...cryptoPayments, ...websitePayments]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setPayments(combinedPayments);
      if (usersRes.data) setUsers(userRows);
      if (packagesRes.data) setPackages(packageRows);

      setStats({
        totalUsers: usersRes.data?.length || 0,
        pendingPayments: combinedPayments.filter(p => p.status === 'pending').length,
        totalRevenue: combinedPayments.filter(p => p.status === 'completed').reduce((acc, curr) => acc + Number(curr.amount), 0)
      });
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void fetchDashboardData(), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!user?.isAdmin) {
    return <Navigate to={ROUTES.PROTECTED.DASHBOARD} replace />;
  }

  const handleConfirmPayment = async (payment: PaymentRow) => {
    try {
      if (payment.source !== 'website') {
        const { data: currentPayment, error: reloadError } = await supabase
          .from('crypto_payments')
          .select('status, provider_status')
          .eq('id', payment.id)
          .single();
        if (reloadError) throw reloadError;
        if (currentPayment.status !== 'pending') {
          throw new Error('This payment is no longer pending.');
        }
        if (currentPayment.provider_status !== 'SUCCESSFUL') {
          throw new Error('Fapshi has not marked this payment as successful.');
        }
      }

      const { error } = payment.source === 'website'
        ? await supabase.rpc('admin_confirm_website_transaction', {
            p_transaction_id: payment.id,
            p_status: 'completed'
          })
        : await supabase.rpc('admin_confirm_payment', {
            p_payment_id: payment.id,
            p_status: 'completed'
          });
      if (error) throw error;
      toast.success('Payment confirmed and credits added');
      fetchDashboardData();
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Error confirming payment'));
    }
  };

  const handleDeclinePayment = async (payment: PaymentRow) => {
    try {
      const { error } = payment.source === 'website'
        ? await supabase.rpc('admin_confirm_website_transaction', {
            p_transaction_id: payment.id,
            p_status: 'failed'
          })
        : await supabase.rpc('admin_confirm_payment', {
            p_payment_id: payment.id,
            p_status: 'failed'
          });
      if (error) throw error;
      toast.success('Payment declined');
      fetchDashboardData();
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Error declining payment'));
    }
  };

  const handleAddCreditsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !creditAmount) return;

    try {
      const { error } = await supabase.rpc('admin_add_credits', {
        p_user_id: selectedUser.id,
        p_amount: Number(creditAmount)
      });
      if (error) throw error;
      toast.success(`Successfully added ${creditAmount} credits to ${selectedUser.email}`);
      setIsAddCreditOpen(false);
      setCreditAmount('');
      fetchDashboardData();
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Error adding credits'));
    }
  };

  const handleEditPackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const credits = Number(packageCredits);
    const priceUsd = Number(packageUsd);
    const priceXaf = Number(packageXaf);

    if (!packageName.trim() || !Number.isInteger(credits) || credits <= 0 || priceUsd < 0 || priceXaf < 0) {
      toast.error('Enter a name, a positive whole credit amount, and valid prices.');
      return;
    }

    try {
      const packageValues = {
        name: packageName.trim(),
        credits,
        price_usd: priceUsd,
        price_xaf: priceXaf,
        is_active: true,
      };

      const { error } = selectedPackage
        ? await supabase.from('credit_packages').update(packageValues).eq('id', selectedPackage.id)
        : await supabase.from('credit_packages').insert(packageValues);
      
      if (error) throw error;
      toast.success(selectedPackage ? 'Package updated successfully' : 'Package created successfully');
      setIsEditPackageOpen(false);
      setSelectedPackage(null);
      fetchDashboardData();
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Error updating package'));
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Admin Dashboard</h1>
          <p className="mt-1 text-muted-foreground">Manage users, view payments, and configure packages.</p>
        </div>
        <Button variant="secondary" onClick={fetchDashboardData} disabled={isLoading}>
          <Activity className="w-4 h-4 mr-2" /> Refresh Data
        </Button>
      </div>
      
      {/* Metrics Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground"><AnimatedNumber value={stats.totalUsers} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Payments</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground"><AnimatedNumber value={stats.pendingPayments} /></div>
            <p className="mt-1 text-xs text-muted-foreground">Awaiting confirmation</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue (FCFA)</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground"><AnimatedNumber value={Math.round(stats.totalRevenue)} /></div>
            <p className="mt-1 text-xs text-muted-foreground">From confirmed payments</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="payments" className="w-full">
        <TabsList className="mb-6 border border-border/70 bg-muted/45 p-1">
          <TabsTrigger value="payments" className="data-[state=active]:bg-accent data-[state=active]:text-foreground">
            <CreditCard className="w-4 h-4 mr-2" /> Pending Payments
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-accent data-[state=active]:text-foreground">
            <Users className="w-4 h-4 mr-2" /> Users Directory
          </TabsTrigger>
          <TabsTrigger value="packages" className="data-[state=active]:bg-accent data-[state=active]:text-foreground">
            <Package className="w-4 h-4 mr-2" /> Credit Packages
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Payments</CardTitle>
              <CardDescription>Review and confirm Mobile Money payments received via Fapshi.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-border/70">
                <Table>
                  <TableHeader className="bg-muted/35">
                    <TableRow className="border-border/70 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">User</TableHead>
                      <TableHead className="text-muted-foreground">Amount</TableHead>
                      <TableHead className="text-muted-foreground">Credits</TableHead>
                      <TableHead className="text-muted-foreground">Fapshi Status</TableHead>
                      <TableHead className="text-muted-foreground">Status</TableHead>
                      <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.length === 0 ? (
                        <TableRow className="border-border/70 hover:bg-transparent">
                           <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                             No payments found.
                           </TableCell>
                        </TableRow>
                     ) : (
                       payments.map(p => (
                         <TableRow key={p.id} className="border-border/70 hover:bg-muted/35">
                           <TableCell className="font-medium text-white">
                             <div>{p.users?.name || 'Unknown'}</div>
                              <div className="text-xs font-normal text-muted-foreground">{p.users?.email}</div>
                           </TableCell>
                            <TableCell className="text-foreground/90">
                             <div>{p.currency === 'USD' ? `$${p.amount}` : `${Number(p.amount).toLocaleString()} FCFA`}</div>
                              <div className="text-xs text-muted-foreground">{p.source === 'website' ? 'Website' : 'Fapshi'}</div>
                           </TableCell>
                            <TableCell className="text-foreground/90">{p.credits}</TableCell>
                           <TableCell>
                             {p.reference ? (
                               <div>
                                 <Badge variant="outline" className={
                                   p.provider_status === 'SUCCESSFUL' ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10' :
                                   p.provider_status === 'FAILED' || p.provider_status === 'EXPIRED' ? 'border-red-500/50 text-red-500 bg-red-500/10' :
                                   'border-blue-500/50 text-blue-400 bg-blue-500/10'
                                 }>
                                   {p.provider_status || 'UNKNOWN'}
                                 </Badge>
                                  <div className="mt-1 font-mono text-xs text-muted-foreground">{p.reference}</div>
                               </div>
                             ) : (
                                <span className="text-muted-foreground">—</span>
                             )}
                           </TableCell>
                           <TableCell>
                            <Badge variant={p.status === 'pending' ? 'outline' : 'default'} className={
                              p.status === 'pending' ? 'border-yellow-500/50 text-yellow-500 bg-yellow-500/10' :
                              p.status === 'completed' ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10' :
                              'border-red-500/50 text-red-500 bg-red-500/10'
                            }>
                              {p.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {p.status === 'pending' && (
                              <div className="flex justify-end gap-2">
                                {p.provider_status === 'SUCCESSFUL' && (
                                  <Button variant="accent" size="sm" onClick={() => handleConfirmPayment(p)}>
                                    <Check className="w-4 h-4 mr-1" /> Confirm
                                  </Button>
                                )}
                                <Button variant="destructive" size="sm" onClick={() => handleDeclinePayment(p)}>
                                  <X className="w-4 h-4 mr-1" /> Decline
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="text-white">User Directory</CardTitle>
              <CardDescription>View all registered users and manage their credits.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-border/70">
                <Table>
                  <TableHeader className="bg-muted/35">
                    <TableRow className="border-border/70 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Email</TableHead>
                      <TableHead className="text-muted-foreground">Balance</TableHead>
                      <TableHead className="text-muted-foreground">Role</TableHead>
                      <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.id} className="border-border/70 hover:bg-muted/35">
                        <TableCell className="font-medium text-white">{u.name || 'Unknown'}</TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell className="text-foreground/90">{Array.isArray(u.wallets) ? u.wallets[0]?.credits || 0 : u.wallets?.credits || 0} credits</TableCell>
                        <TableCell>
                          {u.is_admin ? (
                            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Admin</Badge>
                          ) : (
                            <Badge variant="outline" className="border-border text-muted-foreground">User</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(u);
                              setCreditAmount('');
                              setIsAddCreditOpen(true);
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Add Credits
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packages">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-white">Credit Packages</CardTitle>
                <CardDescription>Configure credits and pricing for top-up packages.</CardDescription>
              </div>
              <Button
                variant="accent"
                onClick={() => {
                  setSelectedPackage(null);
                  setPackageName('');
                  setPackageCredits('');
                  setPackageUsd('');
                  setPackageXaf('');
                  setIsEditPackageOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" /> Add Package
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-border/70">
                <Table>
                  <TableHeader className="bg-muted/35">
                    <TableRow className="border-border/70 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Package Name</TableHead>
                      <TableHead className="text-muted-foreground">Credits</TableHead>
                      <TableHead className="text-muted-foreground">Price (USD)</TableHead>
                      <TableHead className="text-muted-foreground">Price (XAF)</TableHead>
                      <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packages.map(pkg => (
                      <TableRow key={pkg.id} className="border-border/70 hover:bg-muted/35">
                        <TableCell className="font-medium text-white">{pkg.name}</TableCell>
                        <TableCell className="text-foreground/90">{pkg.credits}</TableCell>
                        <TableCell className="text-muted-foreground">${pkg.price_usd || 0}</TableCell>
                        <TableCell className="text-muted-foreground">{pkg.price_xaf || 0} FCFA</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSelectedPackage(pkg);
                              setPackageName(pkg.name || '');
                              setPackageCredits(pkg.credits?.toString() || '');
                              setPackageUsd(pkg.price_usd?.toString() || '0');
                              setPackageXaf(pkg.price_xaf?.toString() || '0');
                              setIsEditPackageOpen(true);
                            }}
                          >
                            <Edit2 className="w-3 h-3 mr-1" /> Edit Package
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Credits Modal */}
      <Dialog open={isAddCreditOpen} onOpenChange={setIsAddCreditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Credits</DialogTitle>
            <DialogDescription>
              Manually add credits to {selectedUser?.email}'s wallet.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCreditsSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground/90">Credit Amount</label>
                <Input 
                  type="number"
                  min="1"
                  required
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="bg-muted/45"
                  placeholder="e.g. 500"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="minimal" onClick={() => setIsAddCreditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="accent">
                Add Credits
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Package Modal */}
      <Dialog open={isEditPackageOpen} onOpenChange={setIsEditPackageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedPackage ? 'Edit Credit Package' : 'Add Credit Package'}</DialogTitle>
            <DialogDescription>
              {selectedPackage ? 'Update the package credit amount and prices.' : 'Create a new package users can purchase.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditPackageSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground/90">Package Name</label>
                <Input
                  required
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  className="bg-muted/45"
                  placeholder="e.g. Starter"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground/90">Credit Amount</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={packageCredits}
                  onChange={(e) => setPackageCredits(e.target.value)}
                  className="bg-muted/45"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground/90">Price in USD ($)</label>
                <Input 
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={packageUsd}
                  onChange={(e) => setPackageUsd(e.target.value)}
                  className="bg-muted/45"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground/90">Price in XAF (FCFA)</label>
                <Input
                  type="number"
                  min="0"
                  required
                  value={packageXaf}
                  onChange={(e) => setPackageXaf(e.target.value)}
                  className="bg-muted/45"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="minimal" onClick={() => setIsEditPackageOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="accent">
                {selectedPackage ? 'Save Changes' : 'Create Package'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
