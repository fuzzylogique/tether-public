// Imported first so dotenv runs before any module that reads process.env at load time.
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname });
