import { createContext } from "react";
/** A Note supplies its own destination; document media never infers edit access. */
export const DocumentNoteContext = createContext<string | undefined>(undefined);
