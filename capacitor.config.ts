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
  plugins: {
    // Android keeps the app between the status bar and the navigation bar (index.html has no viewport-fit=cover),
    // with light icons on the dark background.
    SystemBars: { style: "DARK" },
    // Phone notifications: the logo in the status bar, in the brand color
    LocalNotifications: { smallIcon: "ic_stat_hchat", iconColor: "#8C2A3F" },
  },
};

export default config;
