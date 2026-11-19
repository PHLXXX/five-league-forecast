import test from "node:test";
import assert from "node:assert/strict";

import { finiteNumberOrNull } from "../src/numbers.js";

test("缺失比分不会被转换成伪造的零分", () => {
  assert.equal(finiteNumberOrNull(null), null);
  assert.equal(finiteNumberOrNull(undefined), null);
  assert.equal(finiteNumberOrNull(""), null);
  assert.equal(finiteNumberOrNull("0"), 0);
  assert.equal(finiteNumberOrNull(2), 2);
});
