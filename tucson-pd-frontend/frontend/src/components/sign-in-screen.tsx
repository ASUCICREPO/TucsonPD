import { Lock, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function SignInScreen() {
  const { login, isLoading } = useAuth();

  const handleSignIn = async () => {
    try {
      await login();
    } catch (error: any) {
      // If the user somehow already has a session and hits this screen,
      // a page reload will let AuthContext pick it up and route them correctly.
      if (error?.name === 'UserAlreadyAuthenticatedException') {
        window.location.reload();
      } else {
        console.error('Login error:', error);
      }
    }
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
                <p className="text-slate-600 text-center mb-8">
                  Sign in with your TPD credentials to access the records processing system.
                </p>

                <button
                  onClick={handleSignIn}
                  disabled={isLoading}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Checking session...' : 'Sign In with TPD Credentials'}
                </button>

                {/* Security Notice */}
                <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-slate-600 text-center">
                    This system is restricted to authorized users only. All activities are monitored and logged.
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