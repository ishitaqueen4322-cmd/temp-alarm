import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEYS = {
  HEAT_LIMIT: "tempalarm_heat_limit",
  COLD_LIMIT: "tempalarm_cold_limit",
  MONITORING: "tempalarm_monitoring",
  LAST_TEMP: "tempalarm_last_temp",
  LAST_ALERT: "tempalarm_last_alert",
};

export async function saveMonitoringState(
  heatLimit: string,
  coldLimit: string,
  active: boolean
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.HEAT_LIMIT, heatLimit);
  await AsyncStorage.setItem(STORAGE_KEYS.COLD_LIMIT, coldLimit);
  await AsyncStorage.setItem(STORAGE_KEYS.MONITORING, active ? "true" : "false");
}

export async function loadMonitoringState(): Promise<{
  heatLimit: string | null;
  coldLimit: string | null;
  monitoring: boolean;
}> {
  const [h, c, m] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.HEAT_LIMIT),
    AsyncStorage.getItem(STORAGE_KEYS.COLD_LIMIT),
    AsyncStorage.getItem(STORAGE_KEYS.MONITORING),
  ]);
  return { heatLimit: h, coldLimit: c, monitoring: m === "true" };
}
