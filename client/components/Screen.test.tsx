import React from "react";
import renderer from "react-test-renderer";
import { Text, View } from "react-native";

let mockIsFocused = false;

jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockIsFocused }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("uniwind", () => ({ withUniwind: (component: unknown) => component }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-keyboard-aware-scroll-view", () => {
  const ReactModule = require("react");
  const Native = require("react-native");
  return {
    KeyboardAwareScrollView: (props: Record<string, unknown>) => ReactModule.createElement(Native.View, props),
    KeyboardAwareFlatList: (props: Record<string, unknown>) => ReactModule.createElement(Native.View, props),
    KeyboardAwareSectionList: (props: Record<string, unknown>) => ReactModule.createElement(Native.View, props),
  };
});

import { Screen } from "./Screen";

test("inactive screens hide their full accessibility tree", () => {
  let tree: renderer.ReactTestRenderer;
  renderer.act(() => {
    tree = renderer.create(<Screen><Text>非活动页面</Text></Screen>);
  });
  const wrapper = tree!.root.findAllByType(View)[0];
  expect(wrapper.props.accessibilityElementsHidden).toBe(true);
  expect(wrapper.props.importantForAccessibility).toBe("no-hide-descendants");
  expect(wrapper.props["aria-hidden"]).toBe(true);

  mockIsFocused = true;
  renderer.act(() => tree!.update(<Screen><Text>活动页面</Text></Screen>));
  const focusedWrapper = tree!.root.findAllByType(View)[0];
  expect(focusedWrapper.props.accessibilityElementsHidden).toBe(false);
  expect(focusedWrapper.props.importantForAccessibility).toBe("auto");
});
