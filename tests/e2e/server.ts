import { createApp } from "../../src/server/app.js";
// Test-only HTTP server. Browser tests intercept API responses; no production credentials or data.
const unavailable = async (): Promise<never> => {
  throw new Error("Test API must be intercepted");
};
createApp(
  {
    APP_ORIGIN: "http://127.0.0.1:3100",
    PORT: 3100,
    NODE_ENV: "test",
    TRUST_PROXY_HOPS: 0,
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  },
  {
    auth: {
      verify: unavailable,
      login: unavailable,
      refresh: unavailable,
      recover: unavailable,
      verifyOtp: unavailable,
      updatePassword: unavailable,
    },
    privileged: {
      ensureIdentity: unavailable,
      updateEmail: unavailable,
      logout: unavailable,
      recordVerifiedLogin: unavailable,
    },
    repository: () => ({
      profile: unavailable,
      rpc: unavailable,
      list: unavailable,
    }),
  },
).listen(3100, "127.0.0.1");
