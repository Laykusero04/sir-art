import { createContext } from "react";

export const GuideContext = createContext<(() => void) | null>(null);
