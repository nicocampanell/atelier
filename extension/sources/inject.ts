// Adapted from Pond (MIT) apps/extension/sources/inject.ts @ deb305e
import type { SourceId } from "../lib/contracts";
import { inject as arena } from "./arena/inject";
import { inject as instagram } from "./instagram/inject";
import { inject as pinterest } from "./pinterest/inject";
import { inject as twitter } from "./twitter/inject";

/** MAIN-world hooks; importing this from an isolated script would patch the wrong `fetch`. */
export const INJECTORS: Record<SourceId, () => void> = { twitter, instagram, pinterest, arena };
