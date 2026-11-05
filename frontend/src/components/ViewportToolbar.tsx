import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { layout } from "../styles/layout";

function createStore() {
  const owners = new Map<symbol, ReactNode>();
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => [...owners.values()].at(-1) ?? null,
    remove: (owner: symbol) => {
      owners.delete(owner);
      listeners.forEach((listener) => listener());
    },
    publish: (owner: symbol, content: ReactNode) => {
      owners.set(owner, content);
      listeners.forEach((listener) => listener());
    },
  };
}
const Context = createContext<ReturnType<typeof createStore> | null>(null);
export function ViewportToolbarProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function ViewportToolbarHost() {
  const store = useContext(Context)!;
  const content = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => null,
  );
  return content ? <View pointerEvents="box-none" nativeID="viewport-toolbar" style={layout.toolbarControls}>{content}</View> : null;
}
/** Editors register controls; the existing viewport shell owns keyboard docking. */
export function ViewportToolbar({ children, floating = false }: { children: ReactNode; floating?: boolean }) {
  const store = useContext(Context);
  const owner = useRef(Symbol("viewport-toolbar"));
  useLayoutEffect(() => {
    store?.publish(owner.current, floating ? <View pointerEvents="box-none" nativeID="floating-viewport-toolbar">{children}</View> : children);
  }, [store, children, floating]);
  useLayoutEffect(() => {
    const id = owner.current;
    return () => store?.remove(id);
  }, [store]);
  return store ? null : children;
}
