import React, { useState } from "react";
import renderer, { act } from "react-test-renderer";
import { ScrollView, Text } from "react-native";
import { BirthdayPicker } from "./BirthdayPicker";

test("changing the month in the wheel clamps a leap-year birthday", () => {
  jest.useFakeTimers();
  function Form() {
    const [value, setValue] = useState({ year: 2000, month: 1, day: 31 });
    return <BirthdayPicker value={value} onChange={setValue} />;
  }
  let tree: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<Form />); });
  const monthWheel = tree!.root.findAllByType(ScrollView)[1];
  act(() => monthWheel.props.onScroll({ nativeEvent: { contentOffset: { y: 44 } } }));
  act(() => jest.advanceTimersByTime(150));
  const dayWheel = tree!.root.findAllByType(ScrollView)[2];
  expect(dayWheel.props.accessibilityValue.now).toBe(29);
  expect(dayWheel.props.accessibilityValue.max).toBe(29);
  expect(tree!.root.findAllByType(Text).some((text) => text.props.children === "出生日期")).toBe(true);
  act(() => tree!.unmount());
  jest.useRealTimers();
});
