import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TextureButton } from '@/components/ui/texture-button';
import { useAuth } from '@/context/AuthContext';
import { ROUTES } from '@/lib/routes';
import { toast } from 'sonner';

function Login() {
  const { login, register, loading, error, clearError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname !== ROUTES.PUBLIC.SIGNUP;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  useEffect(() => {
    clearError();
  }, [clearError, isLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isLogin) {
        await login(email, password);
        toast.success('Welcome back!');
      } else {
        await register(email, name, password);
        toast.success('Account created successfully!');
      }
    } catch {
      // Error is handled by the auth context and shown via toast
    }
  };

  const toggleMode = () => {
    clearError();
    navigate(isLogin ? ROUTES.PUBLIC.SIGNUP : ROUTES.PUBLIC.LOGIN);
  };

  return (
    <div className="mesh-bg min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-panel flex items-center justify-center overflow-hidden">
            <img src="./logo.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <span className="text-xl font-semibold text-foreground tracking-tight">Henshin 変身</span>
        </div>

        <Card>
          <CardHeader className="pb-6">
            <CardTitle className="text-xl font-semibold text-foreground text-center">
              {isLogin ? 'Sign in to your account' : 'Create your account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Full Name</label>
                  <Input
                    type="text"
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 border-input bg-panel text-foreground placeholder:text-muted-foreground/60"
                    disabled={loading}
                    required={!isLogin}
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Email</label>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 border-input bg-panel text-foreground placeholder:text-muted-foreground/60"
                  disabled={loading}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-muted-foreground">Password</label>
                  {isLogin && (
                    <TextureButton
                      variant="minimal"
                      size="sm"
                      className="!bg-transparent"
                      contentClassName="min-h-0 !bg-transparent px-0 py-0 text-blue-400 hover:text-blue-300"
                      onClick={() => toast.info('Password reset coming soon')}
                    >
                      Forgot password?
                    </TextureButton>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 border-input bg-panel text-foreground placeholder:text-muted-foreground/60 pr-10"
                    disabled={loading}
                    required
                    minLength={6}
                  />
                  <TextureButton
                    variant="icon"
                    size="icon"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 !bg-transparent"
                    contentClassName="!bg-transparent"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </TextureButton>
                </div>
              </div>
              <CosmicButton
                as="button"
                type="submit"
                disabled={loading}
                className="w-full"
                contentClassName="min-h-11"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Please wait...
                  </span>
                ) : (
                  isLogin ? 'Sign In' : 'Create Account'
                )}
              </CosmicButton>
            </form>

            <div className="mt-6 text-center">
              <span className="text-sm text-muted-foreground">
                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                <TextureButton
                  variant="minimal"
                  size="sm"
                  onClick={toggleMode}
                  className="!bg-transparent"
                  contentClassName="min-h-0 !bg-transparent px-0 py-0 text-blue-400 hover:text-blue-300"
                  disabled={loading}
                >
                  {isLogin ? 'Create account' : 'Sign in'}
                </TextureButton>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Login;
