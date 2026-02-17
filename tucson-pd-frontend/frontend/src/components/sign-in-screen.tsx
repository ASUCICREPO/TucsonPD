import { useState } from 'react';
import { Lock, Shield, AlertCircle } from 'lucide-react';

interface SignInScreenProps {
  onSignIn: (userRole: 'admin' | 'officer', userData: { name: string; badgeId: string; email: string }) => void;
  onNavigateToSignUp: () => void;
}

export function SignInScreen({ onSignIn, onNavigateToSignUp }: SignInScreenProps) {
  const [badgeId, setBadgeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!badgeId || !password) {
      setError('Please enter both Badge ID and Password');
      return;
    }

    // Check for admin credentials
    if (badgeId === 'admin' && password === '5678') {
      setLoading(true);
      setTimeout(() => {
        onSignIn('admin', { name: 'Admin User', badgeId: 'ADMIN-001', email: 'admin@tpd.gov' });
        setLoading(false);
      }, 1000);
      return;
    }

    // Check for officer credentials
    if (badgeId === '1234' && password === '5678') {
      setLoading(true);
      setTimeout(() => {
        onSignIn('officer', { name: 'John Smith', badgeId: 'OFF-5429', email: 'officer@gmail.com' });
        setLoading(false);
      }, 1000);
      return;
    }

    // Invalid credentials
    setError('Invalid email or password. Please try again.');
  };

  return (
    <div className="min-h-screen bg-slate-900 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,.05) 10px, rgba(255,255,255,.05) 20px)'
        }} />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Top Logo Bar */}
        <div className="py-6 px-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="text-white">Tucson Police Department</div>
              <div className="text-slate-400">Records Processing System</div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center px-8 py-12">
          <div className="w-full max-w-md">
            {/* Sign-In Card */}
            <div className="bg-white rounded-lg shadow-2xl border border-slate-200">
              {/* Card Header */}
              <div className="bg-slate-800 text-white py-6 px-8 rounded-t-lg">
                <div className="flex items-center justify-center mb-3">
                  <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
                    <Lock className="w-8 h-8 text-white" />
                  </div>
                </div>
                <h1 className="text-white text-center mb-2">
                  TPD Records Processing System
                </h1>
                <p className="text-slate-300 text-center">
                  Authorized Personnel Only
                </p>
              </div>

              {/* Card Body */}
              <div className="p-8">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Error Message */}
                  {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-red-800">{error}</p>
                    </div>
                  )}

                  {/* Badge ID Field */}
                  <div>
                    <label htmlFor="badgeId" className="block text-slate-900 mb-2">
                      Badge ID
                    </label>
                    <input
                      id="badgeId"
                      type="text"
                      value={badgeId}
                      onChange={(e) => setBadgeId(e.target.value)}
                      placeholder="Enter your badge ID"
                      className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                    />
                  </div>

                  {/* Password Field */}
                  <div>
                    <label htmlFor="password" className="block text-slate-900 mb-2">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                    />
                  </div>

                  {/* Forgot Password Link */}
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => alert('Please contact your system administrator for password reset assistance.')}
                      className="text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      Forgot Password?
                    </button>
                  </div>

                  {/* Sign In Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Signing In...' : 'Sign In'}
                  </button>
                </form>

                {/* Security Notice */}
                <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-slate-600 text-center">
                    This system is restricted to authorized users only. All activities are monitored and logged.
                  </p>
                </div>

                {/* Sign Up Link */}
                <div className="mt-6 text-center">
                  <p className="text-slate-600">
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={onNavigateToSignUp}
                      className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                    >
                      Create Account
                    </button>
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Bottom Footer */}
        <div className="py-4 px-8 text-center text-slate-400">
          <p>TPD Records Processing System v1.0 | Secure Access Portal</p>
        </div>
      </div>
    </div>
  );
}