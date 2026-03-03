import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  Platform,
  Vibration,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";
import { saveMonitoringState, loadMonitoringState, STORAGE_KEYS } from "@/lib/backgroundTask";

const C = Colors.dark;

type AlertType = "heat" | "cold" | null;

interface WeatherData {
  temperature: number;
}

let webAudioContext: AudioContext | null = null;
let webAlarmInterval: ReturnType<typeof setInterval> | null = null;

function playWebBeep(frequency: number) {
  if (typeof window === "undefined") return;
  try {
    if (!webAudioContext) {
      webAudioContext = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    }
    const ctx = webAudioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch {}
}

function startAlarm(type: AlertType) {
  if (Platform.OS === "web") {
    if (webAlarmInterval) return;
    const freq = type === "heat" ? 880 : 440;
    playWebBeep(freq);
    webAlarmInterval = setInterval(() => playWebBeep(freq), 700);
  } else {
    const pattern = [0, 400, 200, 400, 200, 400, 600];
    Vibration.vibrate(pattern, true);
  }
}

function stopAlarm() {
  if (Platform.OS === "web") {
    if (webAlarmInterval) {
      clearInterval(webAlarmInterval);
      webAlarmInterval = null;
    }
  } else {
    Vibration.cancel();
  }
}

async function fetchTemperature(
  lat: number,
  lon: number
): Promise<{ temperature: number }> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m&temperature_unit=celsius`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");
  const data = await res.json();
  const temperature = data.current?.temperature_2m ?? null;
  if (temperature === null) throw new Error("No temperature data");
  return { temperature };
}

function ThermometerDisplay({
  temperature,
  heatLimit,
  coldLimit,
}: {
  temperature: number | null;
  heatLimit: number | null;
  coldLimit: number | null;
}) {
  const fillAnim = useSharedValue(0.3);

  useEffect(() => {
    const normalized =
      temperature !== null
        ? Math.max(0, Math.min(1, (temperature + 20) / 120))
        : 0.3;
    fillAnim.value = withSpring(normalized, { damping: 12 });
  }, [temperature]);

  const fillStyle = useAnimatedStyle(() => ({
    height: `${fillAnim.value * 100}%`,
  }));

  const isHot =
    temperature !== null && heatLimit !== null && temperature > heatLimit;
  const isCold =
    temperature !== null && coldLimit !== null && temperature < coldLimit;

  const thermColor = isHot ? C.heat : isCold ? C.cold : C.accent;

  return (
    <View style={thermStyles.container}>
      <View style={thermStyles.tube}>
        <View style={thermStyles.tubeInner}>
          <Animated.View
            style={[thermStyles.fill, fillStyle, { backgroundColor: thermColor }]}
          />
        </View>
      </View>
      <View style={[thermStyles.bulb, { backgroundColor: thermColor }]}>
        <View style={thermStyles.bulbInner} />
      </View>
    </View>
  );
}

const thermStyles = StyleSheet.create({
  container: { alignItems: "center", height: 160, width: 40 },
  tube: {
    width: 20,
    flex: 1,
    backgroundColor: C.surfaceElevated,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: C.border,
    justifyContent: "flex-end",
  },
  tubeInner: { width: "100%", height: "100%", justifyContent: "flex-end" },
  fill: { width: "100%", borderRadius: 10 },
  bulb: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginTop: -6,
    justifyContent: "center",
    alignItems: "center",
  },
  bulbInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
});

function PulsingDot({ active }: { active: boolean }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 600, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 600, easing: Easing.in(Easing.ease) })
        ),
        -1,
        false
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 600 }),
          withTiming(1, { duration: 600 })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      scale.value = withSpring(1);
      opacity.value = withTiming(1);
    }
  }, [active]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        dotStyles.dot,
        { backgroundColor: active ? C.success : C.textMuted },
        animStyle,
      ]}
    />
  );
}

const dotStyles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5 },
});

function LimitInput({
  label,
  value,
  onChange,
  color,
  icon,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  color: string;
  icon: string;
  disabled: boolean;
}) {
  return (
    <View style={inputStyles.container}>
      <View style={[inputStyles.iconBox, { backgroundColor: color + "22" }]}>
        <MaterialCommunityIcons name={icon as never} size={20} color={color} />
      </View>
      <View style={inputStyles.labelBox}>
        <Text style={inputStyles.label}>{label}</Text>
      </View>
      <View style={inputStyles.inputWrapper}>
        <TextInput
          style={[inputStyles.input, disabled && inputStyles.disabled]}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholder="--"
          placeholderTextColor={C.textMuted}
          editable={!disabled}
          maxLength={5}
        />
        <Text style={inputStyles.unit}>°C</Text>
      </View>
    </View>
  );
}

const inputStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  labelBox: { flex: 1 },
  label: { fontFamily: "Outfit_500Medium", fontSize: 15, color: C.textSecondary },
  inputWrapper: { flexDirection: "row", alignItems: "center", gap: 4 },
  input: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: C.text,
    textAlign: "right",
    minWidth: 60,
  },
  unit: { fontFamily: "Outfit_500Medium", fontSize: 16, color: C.textSecondary },
  disabled: { opacity: 0.5 },
});

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  const [heatLimitStr, setHeatLimitStr] = useState<string>("35");
  const [coldLimitStr, setColdLimitStr] = useState<string>("10");
  const [monitoring, setMonitoring] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertType, setAlertType] = useState<AlertType>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(60);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertShownRef = useRef<AlertType>(null);

  const heatLimit = parseFloat(heatLimitStr);
  const coldLimit = parseFloat(coldLimitStr);

  useEffect(() => {
    loadMonitoringState().then(({ heatLimit: h, coldLimit: c }) => {
      if (h) setHeatLimitStr(h);
      if (c) setColdLimitStr(c);
    });
  }, []);

  const checkAlerts = useCallback(
    (temp: number) => {
      const hL = parseFloat(heatLimitStr);
      const cL = parseFloat(coldLimitStr);

      if (!isNaN(hL) && temp > hL && alertShownRef.current !== "heat") {
        alertShownRef.current = "heat";
        setAlertType("heat");
        startAlarm("heat");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (!isNaN(cL) && temp < cL && alertShownRef.current !== "cold") {
        alertShownRef.current = "cold";
        setAlertType("cold");
        startAlarm("cold");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else if (!isNaN(hL) && !isNaN(cL) && temp >= cL && temp <= hL) {
        alertShownRef.current = null;
      }
    },
    [heatLimitStr, coldLimitStr]
  );

  const doFetch = useCallback(async () => {
    try {
      setError(null);
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const data = await fetchTemperature(pos.coords.latitude, pos.coords.longitude);
      setWeather(data);
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_TEMP, data.temperature.toString());
      const now = new Date();
      setLastUpdated(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
      checkAlerts(data.temperature);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to fetch temperature. Check connection."
      );
    }
  }, [checkAlerts]);

  const startMonitoring = useCallback(async () => {
    const hL = parseFloat(heatLimitStr);
    const cL = parseFloat(coldLimitStr);

    if (isNaN(hL) || isNaN(cL)) {
      Alert.alert("Invalid Limits", "Please enter valid temperature limits.");
      return;
    }
    if (cL >= hL) {
      Alert.alert("Invalid Limits", "Cold limit must be lower than heat limit.");
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Location Required",
        "Please allow location access to monitor your local temperature."
      );
      return;
    }

    await saveMonitoringState(heatLimitStr, coldLimitStr, true);

    setMonitoring(true);
    setLoading(true);
    alertShownRef.current = null;
    await doFetch();
    setLoading(false);
    setCountdown(60);

    intervalRef.current = setInterval(async () => {
      setLoading(true);
      await doFetch();
      setLoading(false);
      setCountdown(60);
    }, 60000);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 60));
    }, 1000);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [heatLimitStr, coldLimitStr, doFetch]);

  const stopMonitoring = useCallback(async () => {
    setMonitoring(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    stopAlarm();
    setAlertType(null);
    alertShownRef.current = null;
    setCountdown(60);
    await saveMonitoringState(heatLimitStr, coldLimitStr, false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [heatLimitStr, coldLimitStr]);

  const dismissAlert = useCallback(() => {
    stopAlarm();
    setAlertType(null);
    alertShownRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      stopAlarm();
    };
  }, []);

  const isHot = weather !== null && !isNaN(heatLimit) && weather.temperature > heatLimit;
  const isCold = weather !== null && !isNaN(coldLimit) && weather.temperature < coldLimit;
  const tempColor = isHot ? C.heat : isCold ? C.cold : C.accent;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.screen, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      <LinearGradient colors={["#0D1525", "#0A0F1E"]} style={StyleSheet.absoluteFill} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <MaterialCommunityIcons name="thermometer" size={28} color={C.accent} />
          <Text style={styles.headerTitle}>Temp Alarm</Text>
          <View style={styles.statusRow}>
            <PulsingDot active={monitoring} />
            <Text style={styles.statusText}>{monitoring ? "Monitoring" : "Idle"}</Text>
          </View>
        </View>

        <View style={styles.tempCard}>
          <LinearGradient
            colors={
              isHot ? ["#2A1008", "#1C0A05"]
              : isCold ? ["#081A2A", "#05101C"]
              : ["#0E1929", "#0A1020"]
            }
            style={StyleSheet.absoluteFill}
            borderRadius={24}
          />
          <View style={styles.tempCardBorder} />

          <View style={styles.tempMain}>
            <ThermometerDisplay
              temperature={weather?.temperature ?? null}
              heatLimit={isNaN(heatLimit) ? null : heatLimit}
              coldLimit={isNaN(coldLimit) ? null : coldLimit}
            />
            <View style={styles.tempTextBlock}>
              <Text style={styles.tempLabel}>Current Temperature</Text>
              {loading ? (
                <View style={styles.tempLoadingRow}>
                  <Feather name="loader" size={20} color={C.textMuted} />
                  <Text style={styles.tempLoadingText}>Fetching...</Text>
                </View>
              ) : weather ? (
                <Text style={[styles.tempValue, { color: tempColor }]}>
                  {weather.temperature.toFixed(1)}
                  <Text style={styles.tempDeg}>°C</Text>
                </Text>
              ) : (
                <Text style={styles.tempDash}>--°C</Text>
              )}
              {isHot && (
                <View style={styles.statusBadge}>
                  <MaterialCommunityIcons name="fire" size={14} color={C.heat} />
                  <Text style={[styles.badgeText, { color: C.heat }]}>Above Heat Limit</Text>
                </View>
              )}
              {isCold && (
                <View style={styles.statusBadge}>
                  <MaterialCommunityIcons name="snowflake" size={14} color={C.cold} />
                  <Text style={[styles.badgeText, { color: C.cold }]}>Below Cold Limit</Text>
                </View>
              )}
            </View>
          </View>

          {lastUpdated && (
            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={13} color={C.textMuted} />
              <Text style={styles.metaText}>Updated {lastUpdated}</Text>
              {monitoring && (
                <>
                  <View style={styles.metaDot} />
                  <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                  <Text style={styles.metaText}>Next in {countdown}s</Text>
                </>
              )}
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color={C.heat} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.limitsSection}>
          <Text style={styles.sectionTitle}>Temperature Limits</Text>
          <View style={styles.limitsCard}>
            <LimitInput
              label="Heat Limit"
              value={heatLimitStr}
              onChange={setHeatLimitStr}
              color={C.heat}
              icon="thermometer-high"
              disabled={monitoring}
            />
            <View style={styles.limitDivider} />
            <LimitInput
              label="Cold Limit"
              value={coldLimitStr}
              onChange={setColdLimitStr}
              color={C.cold}
              icon="thermometer-low"
              disabled={monitoring}
            />
          </View>
          <View style={styles.limitsHint}>
            <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
            <Text style={styles.limitsHintText}>
              Alert triggers when temperature crosses either limit
            </Text>
          </View>
        </View>

        {!monitoring ? (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            onPress={startMonitoring}
          >
            <LinearGradient
              colors={["#4F8EF7", "#2563EB"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <View style={styles.primaryBtnContent}>
              <Ionicons name="play-circle" size={22} color="#fff" />
              <Text style={styles.primaryBtnText}>Start Monitoring</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.stopBtn, pressed && styles.stopBtnPressed]}
            onPress={stopMonitoring}
          >
            <Ionicons name="stop-circle" size={22} color={C.heat} />
            <Text style={styles.stopBtnText}>Stop Monitoring</Text>
          </Pressable>
        )}

        <View style={styles.infoGrid}>
          <View style={styles.infoItem}>
            <MaterialCommunityIcons name="map-marker-radius" size={18} color={C.textMuted} />
            <Text style={styles.infoLabel}>Location</Text>
            <Text style={styles.infoValue}>{weather ? "GPS Active" : "Not set"}</Text>
          </View>
          <View style={styles.infoSep} />
          <View style={styles.infoItem}>
            <Ionicons name="timer-outline" size={18} color={C.textMuted} />
            <Text style={styles.infoLabel}>Refresh Rate</Text>
            <Text style={styles.infoValue}>60 sec</Text>
          </View>
          <View style={styles.infoSep} />
          <View style={styles.infoItem}>
            <MaterialCommunityIcons name="weather-partly-cloudy" size={18} color={C.textMuted} />
            <Text style={styles.infoLabel}>Source</Text>
            <Text style={styles.infoValue}>Open-Meteo</Text>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={alertType !== null}
        transparent
        animationType="fade"
        onRequestClose={dismissAlert}
      >
        <View style={modalStyles.overlay}>
          <View style={modalStyles.container}>
            <LinearGradient
              colors={alertType === "heat" ? ["#2A0E05", "#1A0A03"] : ["#041322", "#020D19"]}
              style={StyleSheet.absoluteFill}
              borderRadius={28}
            />
            <View
              style={[
                modalStyles.border,
                { borderColor: alertType === "heat" ? C.heat + "66" : C.cold + "66" },
              ]}
            />

            <View
              style={[
                modalStyles.iconCircle,
                { backgroundColor: alertType === "heat" ? C.heat + "22" : C.cold + "22" },
              ]}
            >
              <MaterialCommunityIcons
                name={alertType === "heat" ? "fire" : "snowflake"}
                size={40}
                color={alertType === "heat" ? C.heat : C.cold}
              />
            </View>

            <Text style={[modalStyles.alertTitle, { color: alertType === "heat" ? C.heat : C.cold }]}>
              {alertType === "heat" ? "HEAT ALERT" : "COLD ALERT"}
            </Text>

            <Text style={modalStyles.alertMessage}>
              {alertType === "heat"
                ? `Temperature is higher than ${isNaN(heatLimit) ? "--" : heatLimit}°C`
                : `Temperature is lower than ${isNaN(coldLimit) ? "--" : coldLimit}°C`}
            </Text>

            <View
              style={[
                modalStyles.tempBadge,
                { backgroundColor: alertType === "heat" ? C.heat + "22" : C.cold + "22" },
              ]}
            >
              <Text
                style={[
                  modalStyles.tempBadgeText,
                  { color: alertType === "heat" ? C.heatLight : C.coldLight },
                ]}
              >
                {weather?.temperature.toFixed(1)}°C
              </Text>
            </View>

            <Text style={modalStyles.advice}>
              {alertType === "heat"
                ? "Please stay hydrated and avoid direct heat."
                : "Wear warm clothes and stay safe."}
            </Text>

            <Pressable
              style={({ pressed }) => [
                modalStyles.okBtn,
                { backgroundColor: alertType === "heat" ? C.heat : C.cold, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={dismissAlert}
            >
              <Text style={modalStyles.okBtnText}>OK, Understood</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32, gap: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 4 },
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text, flex: 1 },
  statusRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.surface, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
  },
  statusText: { fontFamily: "Outfit_500Medium", fontSize: 12, color: C.textSecondary },
  tempCard: { borderRadius: 24, overflow: "hidden", padding: 20, gap: 16 },
  tempCardBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 24, borderWidth: 1, borderColor: "#253257" },
  tempMain: { flexDirection: "row", alignItems: "center", gap: 20 },
  tempTextBlock: { flex: 1, gap: 4 },
  tempLabel: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1 },
  tempValue: { fontFamily: "Outfit_700Bold", fontSize: 56, lineHeight: 64 },
  tempDeg: { fontSize: 30, fontFamily: "Outfit_500Medium" },
  tempDash: { fontFamily: "Outfit_700Bold", fontSize: 56, color: C.textMuted, lineHeight: 64 },
  tempLoadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  tempLoadingText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  badgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 13 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.textMuted, marginHorizontal: 4 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: C.heat + "18", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.heat + "44" },
  errorText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.heatLight, flex: 1, lineHeight: 18 },
  limitsSection: { gap: 10 },
  sectionTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  limitsCard: { backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  limitDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  limitsHint: { flexDirection: "row", alignItems: "center", gap: 6 },
  limitsHintText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  primaryBtn: { borderRadius: 18, overflow: "hidden", height: 56, justifyContent: "center", alignItems: "center" },
  primaryBtnContent: { flexDirection: "row", alignItems: "center", gap: 10 },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 17, color: "#fff" },
  stopBtn: { borderRadius: 18, height: 56, justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 10, backgroundColor: C.heat + "18", borderWidth: 1.5, borderColor: C.heat + "66" },
  stopBtnPressed: { opacity: 0.8 },
  stopBtnText: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.heat },
  infoGrid: { flexDirection: "row", backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  infoItem: { flex: 1, alignItems: "center", gap: 4 },
  infoSep: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  infoLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, textAlign: "center" },
  infoValue: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary, textAlign: "center" },
});

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", alignItems: "center", padding: 24 },
  container: { width: "100%", maxWidth: 360, borderRadius: 28, padding: 28, alignItems: "center", gap: 16, overflow: "hidden" },
  border: { ...StyleSheet.absoluteFillObject, borderRadius: 28, borderWidth: 1.5 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, justifyContent: "center", alignItems: "center" },
  alertTitle: { fontFamily: "Outfit_700Bold", fontSize: 26, letterSpacing: 1, textAlign: "center" },
  alertMessage: { fontFamily: "Outfit_500Medium", fontSize: 16, color: C.text, textAlign: "center", lineHeight: 24 },
  tempBadge: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  tempBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 36, textAlign: "center" },
  advice: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 20 },
  okBtn: { width: "100%", height: 52, borderRadius: 14, justifyContent: "center", alignItems: "center", marginTop: 4 },
  okBtnText: { fontFamily: "Outfit_700Bold", fontSize: 17, color: "#fff" },
});
