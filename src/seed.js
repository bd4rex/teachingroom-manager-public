import { backfillClassroomHistory, initDb } from "./database.js";
import { importSourceExcel } from "./excel.js";

initDb();
const result = await importSourceExcel();
backfillClassroomHistory();
console.log(`Imported ${result.count} classroom rows from Excel.`);
