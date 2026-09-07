import React from "react";
import renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import { focusManager } from "@tanstack/react-query";
import { ServerStateProvider } from "./ServerStateProvider";

test("forwards foreground transitions to queries and removes the listener", () => {
  const focused = jest.spyOn(focusManager, "setFocused");
  const remove = jest.fn();
  let notify: (state: "active" | "background") => void = () => undefined;
  const listener = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, handler) => {
    notify = handler;
    return { remove };
  });
  let tree: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<ServerStateProvider><React.Fragment /></ServerStateProvider>); });
  act(() => notify("background"));
  expect(focused).toHaveBeenLastCalledWith(false);
  act(() => notify("active"));
  expect(focused).toHaveBeenLastCalledWith(true);
  act(() => tree!.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
  listener.mockRestore();
  focused.mockRestore();
});
