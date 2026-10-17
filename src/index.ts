import { Plugin } from "@opencode/plugin/tui";

import { setupUsageLimitsPlugin } from "@/plugin.tsx";

export default Plugin.define({
  id: "sakateka.usage-limits",
  setup: setupUsageLimitsPlugin,
});
