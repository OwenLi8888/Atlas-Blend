import Constants from "expo-constants";

/**
 * API base URL. EXPO_PUBLIC_API_URL wins; otherwise reuse the host the Expo dev server is on
 * (the laptop running both Metro and the API) with the API port. Zero config on a shared LAN.
 */
function guess(): string {
  const host = (Constants.expoConfig as any)?.hostUri ?? (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
  const ip = typeof host === "string" ? host.split(":")[0] : "localhost";
  return `http://${ip}:${process.env.EXPO_PUBLIC_API_PORT ?? 8787}`;
}

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || guess();
