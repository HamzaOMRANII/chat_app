import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.omranisystems.hchat",
  appName: "H_CHAT",
  webDir: "dist",
  android: {
    // Only HTTPS to chat.omranisystems.com; no cleartext traffic
    allowMixedContent: false,
  },
  backgroundColor: "#0A0B10",
};

export default config;
