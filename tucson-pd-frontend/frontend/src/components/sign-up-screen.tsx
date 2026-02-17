import { useState } from 'react';
import { Shield, User, Lock, IdCard, AlertCircle } from 'lucide-react';

interface SignUpScreenProps {
  onSignUp: (userData: { name: string; badgeId: string; password: string }) => void;
  onBackToSignIn: () => void;
}

export function SignUpScreen({ onSignUp, onBackToSignIn }: SignUpScreenProps) {
  const [name, setName] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!name || !badgeId || !password || !confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    // Badge ID validation (alphanumeric)
    const badgeIdRegex = /^[A-Z0-9-]+$/i;
    if (!badgeIdRegex.test(badgeId)) {
      setError('Badge ID must contain only letters, numbers, and hyphens');
      return;
    }

    onSignUp({ name, badgeId, password });
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
            {/* Sign-Up Card */}
            <div className="bg-white rounded-lg shadow-2xl border border-slate-200">
              {/* Card Header */}
              <div className="bg-slate-800 text-white py-6 px-8 rounded-t-lg">
                <div className="flex items-center justify-center mb-3">
                  <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
                    <User className="w-8 h-8 text-white" />
                  </div>
                </div>
                <h1 className="text-white text-center mb-2">
                  TPD Records Processing System
                </h1>
                <p className="text-slate-300 text-center">
                  Create Your Account
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

                  {/* Name Field */}
                  <div>
                    <label htmlFor="name" className="block text-slate-900 mb-2">
                      Full Name
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                    />
                  </div>

                  {/* Badge ID Field */}
                  <div>
                    <label htmlFor="badgeId" className="block text-slate-900 mb-2">
                      Badge ID
                    </label>
                    <input
                      id="badgeId"
                      type="text"
                      value={badgeId}
                      onChange={(e) => setBadgeId(e.target.value.toUpperCase())}
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
                      placeholder="Enter password"
                      className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                    />
                  </div>

                  {/* Confirm Password Field */}
                  <div>
                    <label htmlFor="confirmPassword" className="block text-slate-900 mb-2">
                      Confirm Password
                    </label>
                    <input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                    />
                  </div>

                  {/* Create Account Button */}
                  <button
                    type="submit"
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Create Account
                  </button>
                </form>

                {/* Back to Sign In Link */}
                <div className="mt-6 text-center">
                  <p className="text-slate-600">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={onBackToSignIn}
                      className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                    >
                      Sign In
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