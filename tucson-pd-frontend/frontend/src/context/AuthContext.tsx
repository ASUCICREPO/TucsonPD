import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  fetchAuthSession,
  signInWithRedirect,
  signOut,
} from 'aws-amplify/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Mirrors the group names defined in cognito-config.json */
export type UserGroup = 'Admins' | 'Users';

/** Maps to the existing App.tsx userRole type */
export type UserRole = 'admin' | 'officer';

export interface CurrentUser {
  name: string;
  email: string;
  /** Cognito sub — stable unique identifier for the user */
  sub: string;
}

interface AuthContextValue {
  /** True while the initial session check is in progress */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Cognito group the user belongs to, null if unauthenticated */
  userGroup: UserGroup | null;
  /** Derived role for App.tsx routing — null if unauthenticated */
  userRole: UserRole | null;
  /** User attributes from Cognito */
  currentUser: CurrentUser | null;
  /** Redirect to Cognito Hosted UI */
  login: () => Promise<void>;
  /** Sign out of Cognito and clear local state */
  logout: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derives the app role from a Cognito group name */
function groupToRole(group: UserGroup): UserRole {
  return group === 'Admins' ? 'admin' : 'officer';
}

/**
 * Reads user info and group membership directly from the ID token payload.
 *
 * The ID token contains email, name, sub, and cognito:groups without
 * requiring the aws.cognito.signin.user.admin scope — so this works
 * regardless of what scopes the app client has configured.
 *
 * We deliberately avoid fetchUserAttributes() and getCurrentUser() here
 * because both require the admin scope on the access token.
 */
function parseIdToken(session: Awaited<ReturnType<typeof fetchAuthSession>>): {
  group: UserGroup | null;
  user: CurrentUser | null;
} {
  const payload = session.tokens?.idToken?.payload;
  if (!payload) return { group: null, user: null };

  // Extract group from cognito:groups claim
  const groups = payload['cognito:groups'];
  let group: UserGroup | null = null;
  if (Array.isArray(groups)) {
    if (groups.includes('Admins')) group = 'Admins';
    else if (groups.includes('Users')) group = 'Users';
  }

  // Extract user identity — all present as standard ID token claims
  const user: CurrentUser = {
    sub: String(payload['sub'] ?? ''),
    email: String(payload['email'] ?? ''),
    name: String(
      payload['name'] ??
      payload['email'] ??
      payload['cognito:username'] ??
      ''
    ),
  };

  return { group, user };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userGroup, setUserGroup] = useState<UserGroup | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  /**
   * On mount: check whether a Cognito session already exists.
   *
   * This fires on every page load, including the redirect back from the
   * Cognito Hosted UI. Amplify handles the ?code= exchange automatically
   * when fetchAuthSession() is called — by the time we read the result,
   * the tokens are already stored.
   */
  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    try {
      const session = await fetchAuthSession();

      if (!session.tokens) {
        setIsAuthenticated(false);
        setUserGroup(null);
        setUserRole(null);
        setCurrentUser(null);
        return;
      }

      // Read everything we need from the ID token — no extra API calls needed
      const { group, user } = parseIdToken(session);

      setIsAuthenticated(true);
      setUserGroup(group);
      setUserRole(group ? groupToRole(group) : null);
      setCurrentUser(user);

    } catch (error) {
      // Not authenticated — normal state before login
      console.log('No active session:', error);
      setIsAuthenticated(false);
      setUserGroup(null);
      setUserRole(null);
      setCurrentUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  /** Initiates the Cognito Hosted UI redirect */
  async function login() {
    await signInWithRedirect();
  }

  /** Signs out of Cognito and resets all local auth state */
  async function logout() {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setIsAuthenticated(false);
      setUserGroup(null);
      setUserRole(null);
      setCurrentUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{
      isLoading,
      isAuthenticated,
      userGroup,
      userRole,
      currentUser,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}