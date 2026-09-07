import { useEffect, useMemo, useRef } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { ageFromBirthday, daysInMonth, normalizeBirthday, type Birthday } from "@/utils/birthday";

function Wheel({ label, values, value, onChange }: {
  label: string;
  values: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const rowHeight = Math.max(44, Math.ceil(28 * fontScale));
  const scroll = useRef<ScrollView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const index = Math.max(0, values.indexOf(value));

  useEffect(() => {
    scroll.current?.scrollTo({ y: index * rowHeight, animated: false });
  }, [index, rowHeight]);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  return <View className="min-w-0 flex-1">
    <Text className="mb-2 text-center text-sm text-copy-muted">{label}</Text>
    <View className="overflow-hidden rounded-xl bg-background-secondary" style={{ height: rowHeight * 3 }}>
      <View pointerEvents="none" className="absolute left-0 right-0 border-y border-brand/40 bg-brand/10" style={{ top: rowHeight, height: rowHeight }} />
      <ScrollView
        ref={scroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={rowHeight}
        decelerationRate="fast"
        bounces={false}
        contentContainerStyle={{ paddingVertical: rowHeight }}
        onLayout={() => scroll.current?.scrollTo({ y: index * rowHeight, animated: false })}
        scrollEventThrottle={16}
        onScroll={(event) => {
          const nextIndex = Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / rowHeight)));
          if (settleTimer.current) clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(() => onChangeRef.current(values[nextIndex]), 120);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={`出生${label}`}
        accessibilityValue={{ min: values[0], max: values[values.length - 1], now: value }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          const offset = nativeEvent.actionName === "increment" ? 1 : -1;
          onChange(values[Math.max(0, Math.min(values.length - 1, index + offset))]);
        }}
      >
        {values.map((item) => <View key={item} className="items-center justify-center" style={{ height: rowHeight }}>
          <Text className={item === value ? "text-lg font-bold text-brand" : "text-base text-copy-muted"}>{item}</Text>
        </View>)}
      </ScrollView>
    </View>
  </View>;
}

export function BirthdayPicker({ value, onChange }: { value: Birthday; onChange: (value: Birthday) => void }) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 68 }, (_, index) => currentYear - 81 + index), [currentYear]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), []);
  const days = useMemo(() => Array.from({ length: daysInMonth(value.year, value.month) }, (_, index) => index + 1), [value.year, value.month]);
  const update = (part: Partial<Birthday>) => onChange(normalizeBirthday({ ...value, ...part }));
  const age = ageFromBirthday(value);

  return <View>
    <Text className="mb-4 text-center text-lg font-bold text-ink">出生日期</Text>
    <View className="flex-row gap-2">
      <Wheel label="年" values={years} value={value.year} onChange={(year) => update({ year })} />
      <Wheel label="月" values={months} value={value.month} onChange={(month) => update({ month })} />
      <Wheel label="日" values={days} value={value.day} onChange={(day) => update({ day })} />
    </View>
    <Text className="mt-4 text-center text-base font-bold text-brand">{value.year} 年 {value.month} 月 {value.day} 日 · {age} 周岁</Text>
    <Text className="mt-2 text-center text-xs text-copy-muted">根据生日计算年龄，用于营养估算</Text>
  </View>;
}
