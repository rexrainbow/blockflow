/* waveform-agent-kit-23be7e737990fd0d41d1 */
import { mkdir as e, open as t, readFile as n, realpath as r, rename as i, stat as a, unlink as o, writeFile as s } from "node:fs/promises";
import { randomUUID as c } from "node:crypto";
import { dirname as l, resolve as u } from "node:path";
import { pathToFileURL as d } from "node:url";
import { parseArgs as f } from "node:util";
// src/lib/waveform/model.js
var p = "blockflow-waveform";
function m(e, t) {
	throw Object.assign(/* @__PURE__ */ Error(`${e}: ${t}`), { path: e });
}
function h(e, t, n) {
	(!e || typeof e != "object" || Array.isArray(e)) && m(n, "expected an object");
	for (let r of Object.keys(e)) t.includes(r) || m(`${n}.${r}`, "unknown field");
}
function g(e, t, n = 0) {
	return (!Number.isSafeInteger(e) || e < n) && m(t, `expected an integer tick >= ${n}`), e;
}
function _(e, t, n) {
	return e === void 0 && n !== void 0 ? n : (typeof e != "string" && m(t, "expected text"), /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(e) && m(t, "text contains invalid XML characters"), e);
}
function v(e, t) {
	return typeof e == "string" && /^[A-Za-z_][\w.-]*$/.test(e) || m(t, "expected an identifier"), e;
}
function y(e, t) {
	return Array.isArray(e) || m(t, "expected a list"), e;
}
function b(e, t, n) {
	return t === 1 ? [
		0,
		1,
		"x",
		"z"
	].includes(e) || m(n, "expected 0, 1, x or z") : typeof e == "number" ? (!Number.isSafeInteger(e) || e < 0 || BigInt(e) >= 1n << BigInt(t)) && m(n, "value exceeds bus width or safe integer range") : typeof e != "string" || !e.length ? m(n, "expected bus text or a nonnegative integer") : e.length > 4096 ? m(n, "bus text exceeds 4096 characters") : /^b[01xz]+$/i.test(e) && e.length - 1 > t ? m(n, "vector exceeds bus width") : /^(?:\d+|0x[\da-f]+|0b[01]+)$/i.test(e) && BigInt(e) >= 1n << BigInt(t) && m(n, "numeric text exceeds bus width"), typeof e == "string" && _(e, n), e;
}
function x(e) {
	h(e, [
		"format",
		"version",
		"title",
		"timescale",
		"grid",
		"length",
		"signals",
		"links",
		"markers"
	], "waveform"), e.format !== "blockflow-waveform" && m("format", `expected ${p}`), e.version !== 1 && m("version", "expected 1");
	let t = {
		format: p,
		version: 1,
		title: _(e.title, "title", "Waveform"),
		timescale: _(e.timescale, "timescale"),
		length: g(e.length, "length", 1),
		signals: []
	};
	t.timescale.trim() || m("timescale", "must not be empty"), e.grid !== void 0 && (h(e.grid, ["ticksPerBit", "offset"], "grid"), t.grid = {
		ticksPerBit: g(e.grid.ticksPerBit, "grid.ticksPerBit", 1),
		offset: g(e.grid.offset ?? 0, "grid.offset")
	});
	let n = /* @__PURE__ */ new Set(), r = /* @__PURE__ */ new Set();
	t.signals = y(e.signals, "signals").map((e, t) => {
		let i = `signals[${t}]`;
		h(e, [
			"id",
			"label",
			"width",
			"scope",
			"port",
			"changes",
			"style"
		], i);
		let a = v(e.id, `${i}.id`);
		n.has(a) && m(`${i}.id`, "duplicate signal id"), n.add(a);
		let o = g(e.width, `${i}.width`, 1);
		o > 4096 && m(`${i}.width`, "maximum width is 4096");
		let s = {
			id: a,
			label: _(e.label, `${i}.label`, a),
			width: o
		};
		e.scope !== void 0 && (s.scope = _(e.scope, `${i}.scope`)), e.port !== void 0 && (s.port = _(e.port, `${i}.port`), /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(s.port) || m(`${i}.port`, "expected Module.port")), e.style !== void 0 && (h(e.style, ["color"], `${i}.style`), typeof e.style.color == "string" && /^#[\da-f]{6}$/i.test(e.style.color) || m(`${i}.style.color`, "expected #RRGGBB"), s.style = { color: e.style.color });
		let c = -1;
		return s.changes = y(e.changes, `${i}.changes`).map((t, n) => {
			let a = `${i}.changes[${n}]`;
			(!Array.isArray(t) || t.length < 2 || t.length > 3) && m(a, "expected [t, value, edgeId?]");
			let s = g(t[0], a);
			s <= c && m(a, "time must increase"), n === 0 && s !== 0 && m(a, "first change must start at 0"), c = s;
			let l = [s, b(t[1], o, a)];
			if (n && l[1] === e.changes[n - 1][1] && m(a, "value must change"), t.length === 3) {
				let e = v(t[2], a);
				r.has(e) && m(a, "duplicate edge id"), r.add(e), l.push(e);
			}
			return l;
		}), s.changes.length || m(`${i}.changes`, "initial value at 0 is required"), s;
	}), e.links !== void 0 && (t.links = y(e.links, "links").map((e, t) => {
		let n = `links[${t}]`;
		h(e, [
			"from",
			"to",
			"label",
			"delay",
			"locked"
		], n);
		let r = {
			from: v(e.from, `${n}.from`),
			to: v(e.to, `${n}.to`)
		};
		return e.label !== void 0 && (r.label = _(e.label, `${n}.label`)), e.delay !== void 0 && (r.delay = g(e.delay, `${n}.delay`)), e.locked !== void 0 && (typeof e.locked != "boolean" && m(`${n}.locked`, "expected a boolean"), r.locked = e.locked), r;
	}));
	let i = /* @__PURE__ */ new Set();
	e.markers !== void 0 && (t.markers = y(e.markers, "markers").map((e, t) => {
		let n = `markers[${t}]`;
		h(e, [
			"id",
			"t",
			"from",
			"to",
			"label"
		], n);
		let r = v(e.id, `${n}.id`);
		i.has(r) && m(`${n}.id`, "duplicate marker id"), i.add(r);
		let a = { id: r };
		return e.t === void 0 ? (a.from = g(e.from, `${n}.from`), a.to = g(e.to, `${n}.to`), a.to <= a.from && m(n, "span to must exceed from")) : ((e.from !== void 0 || e.to !== void 0) && m(n, "choose t or from/to"), a.t = g(e.t, `${n}.t`)), e.label !== void 0 && (a.label = _(e.label, `${n}.label`)), a;
	}));
	let a = S(t);
	for (let [e, n] of (t.links ?? []).entries()) for (let t of ["from", "to"]) {
		let r = a.get(n[t]);
		r && !r.transition && m(`links[${e}].${t}`, "must reference a value-changing edge after time 0");
	}
	return t;
}
function S(e) {
	let t = /* @__PURE__ */ new Map();
	return e.signals.forEach((e, n) => e.changes.forEach((r, i) => {
		r[2] !== void 0 && t.set(r[2], {
			signal: e,
			change: r,
			si: n,
			ci: i,
			transition: i > 0 && r[1] !== e.changes[i - 1][1]
		});
	})), t;
}
function C(e) {
	let t = x(e), n = S(t), r = [];
	function i(e, t, n) {
		r.push({
			path: e,
			code: t,
			message: n
		});
	}
	return t.signals.forEach((e, n) => e.changes.forEach((e, r) => {
		e[0] > t.length && i(`signals[${n}].changes[${r}]`, "BEYOND_LENGTH", "change exceeds length");
	})), (t.links ?? []).forEach((e, t) => {
		for (let r of ["from", "to"]) n.has(e[r]) || i(`links[${t}].${r}`, "MISSING_EDGE", `missing edge ${e[r]}`);
		n.has(e.from) && n.has(e.to) && e.delay !== void 0 && n.get(e.to).change[0] - n.get(e.from).change[0] !== e.delay && i(`links[${t}].delay`, "DELAY_MISMATCH", "stored edge distance disagrees with delay");
	}), (t.markers ?? []).forEach((e, n) => {
		(e.t ?? e.to) > t.length && i(`markers[${n}]`, "BEYOND_LENGTH", "marker exceeds length");
	}), r;
}
function w(e) {
	return x(e), { ok: !0 };
}
function T(e, t, n = "tick") {
	Number.isFinite(t) || m("time", "expected a finite coordinate");
	let r = g(e?.length, "length", 1), i = Math.max(0, Math.min(r, t));
	if (n === "tick") return Math.round(i);
	n !== "bit" && m("level", "expected tick or bit");
	let a = g(e.grid?.ticksPerBit, "grid.ticksPerBit", 1), o = g(e.grid?.offset ?? 0, "grid.offset");
	return o > r && m("grid.offset", "no bit boundary within length"), o + Math.max(0, Math.min(Math.floor((r - o) / a), Math.round((i - o) / a))) * a;
}
// src/lib/blockchart/edit-diff.js
var E = (e) => typeof e == "object" && !!e && !Array.isArray(e);
function D(e, t) {
	if (e === t) return !0;
	if (Array.isArray(e)) return Array.isArray(t) && e.length === t.length && e.every((e, n) => D(e, t[n]));
	if (!E(e) || !E(t)) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && D(e[n], t[n]));
}
function O(e, t) {
	let n = [];
	function r(e, t, i, a) {
		if (e !== t) {
			if (Array.isArray(e) && Array.isArray(t)) {
				if (e.length === t.length) {
					e.forEach((e, n) => r(e, t[n], i + "/" + n, a));
					return;
				}
				let o = 0, s = e.length, c = t.length;
				for (; o < s && o < c && D(e[o], t[o]);) o++;
				for (; s > o && c > o && D(e[s - 1], t[c - 1]);) s--, c--;
				n.push({
					...a,
					path: i,
					index: o,
					removed: e.slice(o, s),
					added: t.slice(o, c)
				});
			} else if (E(e) && E(t)) {
				i.startsWith("/connections/") && Object.hasOwn(t, "from") && (a = { from: t.from });
				for (let o of /* @__PURE__ */ new Set([...Object.keys(e), ...Object.keys(t)])) {
					let s = i + "/" + o.replaceAll("~", "~0").replaceAll("/", "~1");
					Object.hasOwn(e, o) ? Object.hasOwn(t, o) ? r(e[o], t[o], s, a) : n.push({
						...a,
						path: s,
						before: e[o]
					}) : n.push({
						...a,
						path: s,
						after: t[o]
					});
				}
			} else n.push({
				...a,
				path: i,
				before: e,
				after: t
			});
		}
	}
	return r(e, t, "", {}), structuredClone(n);
}
// src/lib/waveform/edit.js
function k(e, t) {
	let n = e.signals.find((e) => e.id === t);
	if (!n) throw Error("Unknown signal: " + t);
	return n;
}
function A(e, t) {
	if (t.edgeId !== void 0) {
		if (t.signalId !== void 0 || t.t !== void 0) throw Error("Choose edgeId or signalId/t");
		let n = S(e).get(t.edgeId);
		if (!n) throw Error("Unknown edge: " + t.edgeId);
		return n.change;
	}
	g(t.t, "t");
	let n = k(e, t.signalId).changes.find((e) => e[0] === t.t);
	if (!n) throw Error(`Unknown change: ${t.signalId} at ${t.t}`);
	return n;
}
function j(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.links ?? []) n.locked && (t.has(n.from) || t.set(n.from, []), t.get(n.from).push(n));
	return t;
}
function M(e, t, n) {
	if (!n.size) return;
	let r = j(e), i = S(t), a = S(e), o = new Map(n), s = [...n.keys()];
	for (let e = 0; e < s.length; e++) {
		let t = s[e];
		for (let e of r.get(t) ?? []) {
			if (!i.has(e.from) || !i.has(e.to) || !a.has(e.to)) throw Error("Locked link has a missing edge");
			let n = e.delay ?? i.get(e.to).change[0] - i.get(e.from).change[0], r = o.get(t) + n;
			if (o.has(e.to) && o.get(e.to) !== r) throw Error("Conflicting locked targets: " + e.to);
			o.has(e.to) || (o.set(e.to, r), s.push(e.to));
		}
	}
	for (let [e, t] of o) g(t, `edge ${e}`), a.get(e).change[0] = t;
}
function N(e) {
	return e.filter((t, n) => n === 0 || t[2] !== void 0 || t[1] !== e[n - 1][1]);
}
function P(e, t) {
	return e.findLast((e) => e[0] <= t)[1];
}
function F(e, t) {
	let n = new Map(t.map((e) => [e[2], e]));
	for (let t of e) if (t[2] !== void 0 && !n.has(t[2])) throw Error("Would remove named edge: " + t[2]);
	t.forEach((e, n) => {
		if (n && e[2] !== void 0 && e[1] === t[n - 1][1]) throw Error("Would erase named transition: " + e[2]);
	});
}
function I(e, t) {
	if (g(e.from, "from"), g(e.to, "to"), e.from >= e.to || e.to > t) throw Error("Expected 0 <= from < to <= length");
}
function ee(e, t) {
	let n = {
		moveEdge: [
			"edgeId",
			"signalId",
			"t",
			"to",
			"followLocked"
		],
		shiftRange: [
			"signalIds",
			"from",
			"to",
			"delta",
			"includeMarkers",
			"followLocked"
		],
		insertTicks: ["at", "count"],
		deleteTicks: ["from", "to"],
		setValue: [
			"signalId",
			"from",
			"to",
			"value"
		],
		encodeBits: [
			"signalId",
			"bits",
			"zeroHigh",
			"oneHigh"
		],
		nameEdge: [
			"edgeId",
			"signalId",
			"t",
			"name"
		],
		followLocked: ["edgeId"],
		setSignal: ["signal"],
		setLinks: ["links"],
		setMarkers: ["markers"],
		updateDocument: ["patch"]
	};
	if (!t || !Object.hasOwn(n, t.op)) throw Error("Unknown operation: " + t?.op);
	if (Object.keys(t).some((e) => e !== "op" && !n[t.op].includes(e))) throw Error("Unknown operation field");
	if (t.followLocked !== void 0 && typeof t.followLocked != "boolean") throw Error("followLocked must be a boolean");
	if (t.includeMarkers !== void 0 && typeof t.includeMarkers != "boolean") throw Error("includeMarkers must be a boolean");
	let r = structuredClone(e), i = /* @__PURE__ */ new Map();
	switch (t.op) {
		case "moveEdge": {
			let n = A(e, t);
			if (!n[0]) throw Error("Initial value at 0 cannot be moved");
			n[0] = g(t.to, "to", 1), n[2] !== void 0 && i.set(n[2], n[0]);
			break;
		}
		case "shiftRange": {
			if (I(t, e.length), !Number.isSafeInteger(t.delta)) throw Error("delta must be an integer");
			let n = t.signalIds ?? e.signals.map((e) => e.id);
			if (!Array.isArray(n) || new Set(n).size !== n.length) throw Error("signalIds must be a list of distinct ids");
			for (let r of n) for (let n of k(e, r).changes) if (!(n[0] < t.from || n[0] >= t.to)) {
				if (!n[0] && t.delta) throw Error("Initial values cannot shift away from 0");
				n[0] += t.delta, n[2] !== void 0 && i.set(n[2], n[0]);
			}
			if (t.includeMarkers ?? t.signalIds === void 0) for (let n of e.markers ?? []) for (let e of [
				"t",
				"from",
				"to"
			]) n[e] >= t.from && n[e] < t.to && (n[e] += t.delta);
			break;
		}
		case "insertTicks":
			if (g(t.at, "at"), g(t.count, "count", 1), t.at > e.length) throw Error("at exceeds length");
			e.length += t.count;
			for (let n of e.signals) for (let e of n.changes) e[0] && e[0] >= t.at && (e[0] += t.count);
			for (let n of e.markers ?? []) for (let e of [
				"t",
				"from",
				"to"
			]) n[e] >= t.at && (n[e] += t.count);
			e.grid && e.grid.offset >= t.at && (e.grid.offset += t.count);
			break;
		case "deleteTicks": {
			if (I(t, e.length), t.to - t.from >= e.length) throw Error("Cannot delete the complete duration");
			let n = (e) => e < t.from ? e : e < t.to ? t.from : e - (t.to - t.from), r = new Set((e.links ?? []).flatMap((e) => [e.from, e.to]));
			for (let i of e.signals) {
				for (let e of i.changes) if (e[0] >= t.from && e[0] < t.to && r.has(e[2])) throw Error("Would delete referenced edge: " + e[2]);
				let e = i.changes.filter((e) => e[0] < t.from || e[0] >= t.to).map((e) => [
					n(e[0]),
					e[1],
					...e.slice(2)
				]);
				e.find((e) => e[0] === t.from) || e.push([t.from, P(i.changes, t.to)]), i.changes = N(e.sort((e, t) => e[0] - t[0]));
			}
			e.length -= t.to - t.from;
			for (let t of e.markers ?? []) for (let e of [
				"t",
				"from",
				"to"
			]) t[e] !== void 0 && (t[e] = n(t[e]));
			e.markers = e.markers?.filter((e) => e.t !== void 0 || e.from < e.to), e.grid && (e.grid.offset = n(e.grid.offset));
			break;
		}
		case "setValue": {
			I(t, e.length);
			let n = k(e, t.signalId), r = n.changes;
			b(t.value, n.width, "value");
			let i = r.filter((e) => e[0] < t.from || e[0] >= t.to);
			i.push([
				t.from,
				t.value,
				...r.find((e) => e[0] === t.from)?.slice(2) ?? []
			]), t.to < e.length && !i.some((e) => e[0] === t.to) && i.push([t.to, P(r, t.to)]), n.changes = N(i.sort((e, t) => e[0] - t[0])), F(r, n.changes);
			break;
		}
		case "encodeBits": {
			if (!e.grid) throw Error("Bit encoding requires grid");
			let n = k(e, t.signalId), { ticksPerBit: r, offset: i } = e.grid;
			if (n.width !== 1 || !Array.isArray(t.bits) || !t.bits.length || t.bits.some((e) => e !== 0 && e !== 1)) throw Error("Expected a bit lane and binary bits");
			for (let e of ["zeroHigh", "oneHigh"]) if (g(t[e], e), t[e] > r) throw Error(e + " must not exceed ticksPerBit");
			if (i + t.bits.length * r > e.length) throw Error("Encoded bits exceed length");
			let a = [[0, 0]];
			t.bits.forEach((e, n) => {
				let o = i + n * r, s = e ? t.oneHigh : t.zeroHigh;
				o ? a.push([o, +!!s]) : a[0][1] = +!!s, s && s < r && a.push([o + s, 0]);
			}), a.push([i + t.bits.length * r, 0]);
			let o = N(a);
			for (let e of o) {
				let t = n.changes.find((t) => t[0] === e[0]);
				t?.[2] !== void 0 && e.push(t[2]);
			}
			F(n.changes, o), n.changes = o;
			break;
		}
		case "nameEdge": {
			let n = A(e, t);
			n[2] = t.name;
			break;
		}
		case "followLocked": {
			let n = (e.links ?? []).filter((e) => e.locked), r = j(e), a = S(e), o = [...new Set(n.map((e) => e.from))], s = new Set(n.map((e) => e.to)), c = /* @__PURE__ */ new Set(), l = t.edgeId === void 0 ? [...o.filter((e) => !s.has(e)), ...o] : [t.edgeId];
			for (let e of l) {
				if (c.has(e)) continue;
				let t = a.get(e);
				if (!t) throw Error("Unknown edge: " + e);
				i.set(e, t.change[0]);
				let n = [e];
				for (let e = 0; e < n.length; e++) c.has(n[e]) || (c.add(n[e]), n.push(...(r.get(n[e]) ?? []).map((e) => e.to)));
			}
			break;
		}
		case "setSignal": {
			let n = e.signals.findIndex((e) => e.id === t.signal?.id);
			n < 0 ? e.signals.push(structuredClone(t.signal)) : e.signals[n] = structuredClone(t.signal);
			break;
		}
		case "setLinks":
			e.links = structuredClone(t.links);
			break;
		case "setMarkers":
			e.markers = structuredClone(t.markers);
			break;
		case "updateDocument":
			if (!t.patch || Object.keys(t.patch).some((e) => ![
				"title",
				"timescale",
				"length",
				"grid"
			].includes(e))) throw Error("Unsupported document field");
			Object.assign(e, structuredClone(t.patch));
			break;
		default: throw Error("Unknown operation: " + t?.op);
	}
	t.followLocked !== !1 && M(e, r, i);
}
function L(e, t, { allowProblems: n = !1 } = {}) {
	let r = x(e);
	Array.isArray(t) || m("operations", "expected a list"), typeof n != "boolean" && m("allowProblems", "expected a boolean");
	for (let [e, n] of t.entries()) try {
		ee(r, structuredClone(n)), r = x(r);
	} catch (t) {
		throw Object.assign(Error(`ops[${e}] ${n?.op}: ${t.message}`, { cause: t }), { path: t.path ?? `ops[${e}]` });
	}
	let i = x(r), a = C(i);
	return !n && a.length && m(a[0].path, a[0].message), {
		document: i,
		diff: O(e, i),
		problems: a
	};
}
// src/lib/shared/svg.js
var R = (e) => String(e).replace(/[&<>"']/g, (e) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&apos;"
})[e]), te = Object.freeze({
	color: "#000000",
	fontSize: 12,
	backgroundColor: "#00000000",
	padding: 0,
	opacity: 1,
	backgroundOpacity: 1,
	hidden: !1
}), ne = (e) => e.replace(/\r\n/g, "\n").split("\n");
function z(e, t = te) {
	if (t.hidden) return {
		width: 0,
		height: 0
	};
	let n = ne(e);
	return {
		width: Math.max(...n.map((e) => Array.from(e).reduce((e, t) => e + (t.codePointAt(0) <= 127 ? 8 : 16), 0))) * t.fontSize / 12,
		height: n.length * t.fontSize * 1.5
	};
}
// src/lib/waveform/link-layout.js
var B = 36, re = (e) => z(e.replace(/\s/g, " ")).width;
function ie(e, { from: t, to: n, left: r, right: i, top: a, laneHeight: o, pixelsPerTick: s, linkRoute: c }) {
	let l = /* @__PURE__ */ new Map();
	e.signals.forEach((e, r) => e.changes.forEach(([i, , a], o) => {
		o && a && i >= t && i <= n && l.set(a, {
			signalIndex: r,
			signalId: e.id,
			t: i
		});
	}));
	let u = Array(e.signals.length ? Math.max(1, e.signals.length - 1) : 0).fill(0), d = [];
	for (let [t, n] of (e.links ?? []).entries()) {
		let r = l.get(n.from), i = l.get(n.to);
		if (!r || !i) continue;
		let a = Math.abs(r.signalIndex - i.signalIndex), o = r.signalIndex < i.signalIndex ? i.signalIndex - 1 : Math.min(i.signalIndex, Math.max(0, e.signals.length - 2)), s = c === "rail" ? "forced" : a > 3 ? "distance" : u[o] >= 8 ? "tracks" : void 0, f = c === "local" || !s ? "local" : "rail", p = f === "local" ? u[o]++ : void 0;
		p >= 32 && m("render.links", "local gutter exceeds 32 tracks; use auto or rail"), d.push({
			index: t,
			link: n,
			route: f,
			reason: f === "rail" ? s : void 0,
			gutter: o,
			track: p,
			a: r,
			b: i
		});
	}
	let f = u.map((e) => e ? 16 + e * B : 0), p = [];
	e.signals.forEach((e, t) => {
		p.push(t ? p[t - 1] + o + Math.max(0, f[t - 1] - (o - 24)) : a + o / 2);
	});
	let h = p.length ? p.at(-1) + o / 2 : a;
	p.length === 1 && u[0] && (h = Math.max(h, p[0] + 24 + f[0]));
	let g = f.map((e, t) => ({
		index: t,
		trackCount: u[t],
		top: (p[t] ?? a) + 12,
		bottom: p[t + 1] === void 0 ? h : p[t + 1] - 12
	})), _ = (e) => r + (e - t) * s, v = 0, y = 0, b = d.map((t) => {
		let { link: n, route: r } = t, a = {
			...t.a,
			x: _(t.a.t),
			y: p[t.a.signalIndex]
		}, o = {
			...t.b,
			x: _(t.b.t),
			y: p[t.b.signalIndex]
		}, s, c, l, u = n.delay === void 0 ? "" : `${n.delay} ${/^\d/.test(e.timescale) ? "× " : ""}${e.timescale}`, d = [n.label, u].filter((e) => e !== void 0 && e !== "").join(" · "), f = re(d);
		if (r === "local") c = g[t.gutter].top + 26 + t.track * B, s = [
			{
				x: a.x,
				y: a.y
			},
			{
				x: a.x,
				y: c
			},
			{
				x: o.x,
				y: c
			},
			{
				x: o.x,
				y: o.y
			}
		];
		else {
			let e = i + 16 + v++ * 10, t = a.y + 16, r = o.y + (o.y <= a.y ? 16 : -16);
			s = [
				{
					x: a.x,
					y: a.y
				},
				{
					x: a.x,
					y: t
				},
				{
					x: e,
					y: t
				},
				{
					x: e,
					y: r
				},
				{
					x: o.x,
					y: r
				},
				{
					x: o.x,
					y: o.y
				}
			], n.delay === void 0 ? (c = (t + r) / 2 + 8, l = e + 3) : c = h + 26 + y++ * B;
		}
		let m = n.delay === void 0 ? void 0 : {
			x1: a.x,
			x2: o.x,
			y: c + 10,
			delay: n.delay
		}, b = d ? {
			text: d,
			width: f,
			x: l ?? (Math.abs(a.x - o.x) >= f + 8 ? (a.x + o.x - f) / 2 : Math.max(a.x, o.x) + 8),
			y: c - 8
		} : void 0;
		return {
			index: t.index,
			link: n,
			route: r,
			reason: t.reason,
			gutter: r === "local" ? t.gutter : void 0,
			track: t.track,
			from: a,
			to: o,
			points: s,
			label: b,
			dimension: m
		};
	}), x = [];
	for (let e of b) {
		let t = e.label;
		if (!t) continue;
		let n = t.y - 12, r = t.y + 4, i = [];
		for (let e of b) e.points.slice(1).forEach((t, a) => {
			let o = e.points[a];
			Math.max(t.y, o.y) >= n && Math.min(t.y, o.y) <= r && i.push([Math.min(t.x, o.x) - 4, Math.max(t.x, o.x) + 4]);
		});
		for (let e of x) e.y + 4 >= n && e.y - 12 <= r && i.push([e.x - 4, e.x + e.width + 4]);
		i.sort((e, t) => e[0] - t[0]);
		for (let [e, n] of i) t.x <= n && t.x + t.width >= e && (t.x = n + 8);
		x.push(t);
	}
	return {
		laneYs: p,
		laneAreaBottom: h,
		linkRoutes: b,
		gutters: g,
		footerHeight: y * B
	};
}
// src/lib/waveform/render.js
function V(e, t = {}) {
	h(t, [
		"from",
		"to",
		"pixelsPerTick",
		"laneHeight",
		"labelWidth",
		"tickStep",
		"idPrefix",
		"linkRoute"
	], "options"), t.idPrefix === void 0 || typeof t.idPrefix == "string" && /^[A-Za-z_][\w.-]*$/.test(t.idPrefix) || m("options.idPrefix", "expected an identifier");
	let n = t.linkRoute ?? "auto";
	[
		"auto",
		"local",
		"rail"
	].includes(n) || m("options.linkRoute", "expected auto, local or rail");
	let r = x(e), i = g(t.from ?? 0, "options.from"), a = g(t.to ?? r.length, "options.to");
	(i >= a || a > r.length) && m("options.to", "expected from < to <= length");
	let o = t.pixelsPerTick ?? 24, s = t.laneHeight ?? 56, c = t.labelWidth ?? 160;
	for (let [e, t] of Object.entries({
		pixelsPerTick: o,
		laneHeight: s,
		labelWidth: c
	})) (!Number.isFinite(t) || t < 1) && m(`options.${e}`, "expected a positive finite number");
	(s < 40 || c < 40) && m("options", "laneHeight and labelWidth must be at least 40");
	let l = g(t.tickStep ?? 1, "options.tickStep", 1);
	(Math.max(0, Math.floor(a / l) - Math.ceil(i / l) + 1) + (r.grid ? Math.max(0, Math.floor((a - r.grid.offset) / r.grid.ticksPerBit) - Math.max(0, Math.ceil((i - r.grid.offset) / r.grid.ticksPerBit)) + 1) : 0) > 1e4 || r.signals.length > 512 || (r.links?.length ?? 0) > 512 || (r.markers?.length ?? 0) > 2048) && m("render", "display limit exceeded; use a shorter time window or larger tickStep");
	let u = c, d = u + (a - i) * o, f = ie(r, {
		from: i,
		to: a,
		left: u,
		right: d,
		top: 64,
		laneHeight: s,
		pixelsPerTick: o,
		linkRoute: n
	}), p = Math.max(0, ...(r.markers ?? []).map((e) => z((e.label ?? "").replace(/\s/g, " ")).width)), _ = Math.max(d + Math.max(32, p) + 16, 24 + z(r.title).width, ...f.linkRoutes.map((e) => e.label ? e.label.x + e.label.width + 16 : Math.max(...e.points.map((e) => e.x)) + 16)), v = f.laneAreaBottom + f.footerHeight + 32, y = v - 16, b = (e) => u + (e - i) * o, S = r.signals.map((e, t) => {
		let n = f.laneYs[t], o = e.changes.flatMap((t, n) => {
			let o = Math.max(i, t[0]), s = Math.min(a, e.changes[n + 1]?.[0] ?? r.length);
			return o < s ? [{
				from: o,
				to: s,
				value: t[1],
				x1: b(o),
				x2: b(s)
			}] : [];
		}), s = e.changes.flatMap((e, t) => t && e[0] >= i && e[0] <= a ? [{
			t: e[0],
			id: e[2],
			x: b(e[0])
		}] : []);
		return {
			...e,
			y: n,
			segments: o,
			edges: s
		};
	});
	S.reduce((e, t) => e + t.segments.length + t.edges.length, 0) > 5e4 && m("render", "visible change limit exceeded; use a smaller time window");
	let C = [], w = (r.markers ?? []).filter((e) => e.label !== void 0 && (e.t ?? e.to) >= i && (e.t ?? e.from) <= a).map((e) => ({
		id: e.id,
		x: b(Math.max(e.t ?? e.from, i)) + 3,
		width: z(e.label.replace(/\s/g, " ")).width
	})).sort((e, t) => e.x - t.x).map((e) => {
		let t = C.findIndex((t) => t + 8 <= e.x);
		return t < 0 && (t = C.length), C[t] = e.x + e.width, {
			...e,
			row: t,
			y: v - 4 + t * 20
		};
	}), T = v + Math.max(0, C.length - 1) * 20;
	return (!Number.isFinite(_) || !Number.isFinite(T) || _ > 1e7 || T > 1e7) && m("render", "SVG dimensions exceed the display limit"), {
		document: r,
		from: i,
		to: a,
		pixelsPerTick: o,
		tickStep: l,
		left: u,
		top: 64,
		right: d,
		width: _,
		height: T,
		laneHeight: s,
		lanes: S,
		plotBottom: y,
		markerLabels: w,
		linkRoutes: f.linkRoutes,
		gutters: f.gutters
	};
}
function H(e, t = {}) {
	let n = V(e, t), r = R(t.idPrefix ?? "blockflow-waveform"), i = (e) => n.left + (e - n.from) * n.pixelsPerTick, a = (e, t, n, r = "") => `<text x="${t}" y="${n}" ${r}>${R(String(e))}</text>`, o = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${n.width}" height="${n.height}" viewBox="0 0 ${n.width} ${n.height}" font-family="monospace" font-size="12">`,
		`<rect width="${n.width}" height="${n.height}" fill="#ffffff"/>`,
		`<defs><clipPath id="${r}-lane-labels"><rect width="${n.left - 8}" height="${n.height}"/></clipPath></defs>`,
		a(n.document.title, 12, 20, "data-role=\"waveform-title\""),
		a(n.document.timescale, 12, 44)
	];
	for (let e = Math.ceil(n.from / n.tickStep) * n.tickStep; e <= n.to; e += n.tickStep) o.push(`<path data-role="tick-grid" data-t="${e}" d="M ${i(e)} ${n.top - 8} V ${n.plotBottom}" stroke="#e3e8ef"/>`, a(e, i(e), n.top - 14, "text-anchor=\"middle\""));
	if (n.document.grid) {
		let { ticksPerBit: e, offset: t } = n.document.grid;
		for (let r = Math.max(0, Math.ceil((n.from - t) / e)); t + r * e <= n.to; r++) {
			let s = t + r * e;
			o.push(`<path data-role="bit-grid" data-bit="${r}" data-t="${s}" d="M ${i(s)} 32 V ${n.plotBottom}" stroke="#8da0b8" stroke-dasharray="4 3"/>`, a(`bit ${r}`, i(s) + 3, 34));
		}
	}
	n.lanes.forEach((e, t) => {
		let n = e.style?.color ?? "#2457a6";
		o.push(`<g data-signal="${R(e.id)}" data-role="waveform-lane"${e.port ? ` data-port="${R(e.port)}"` : ""}>`, a(e.scope ? `${e.scope}/${e.label}` : e.label, 12, e.y + 4, `data-role="signal-label" clip-path="url(#${r}-lane-labels)"`)), e.segments.forEach((i, s) => {
			let { x1: c, x2: l, value: u, from: d, to: f } = i, p = `${r}-segment-${t}-${s}`;
			if (o.push(`<g data-role="value-segment" data-signal="${R(e.id)}" data-from="${d}" data-to="${f}">`), e.width === 1 && (u === 0 || u === 1)) o.push(`<path d="M ${c} ${e.y + (u ? -12 : 12)} H ${l}" fill="none" stroke="${n}" stroke-width="2"/>`);
			else {
				let t = Math.min(6, (l - c) / 3), r = u === "x" ? "#ffeded" : u === "z" ? "#eef0ff" : "#eef5ff";
				o.push(`<path d="M ${c} ${e.y} L ${c + t} ${e.y - 12} H ${l - t} L ${l} ${e.y} L ${l - t} ${e.y + 12} H ${c + t} Z" fill="${r}" stroke="${n}"${u === "z" ? " stroke-dasharray=\"3 3\"" : ""}/>`), o.push(`<defs><clipPath id="${p}"><rect x="${c}" y="${e.y - 12}" width="${l - c}" height="24"/></clipPath></defs>`, a(u, (c + l) / 2, e.y + 4, `text-anchor="middle" clip-path="url(#${p})" data-role="segment-value"`));
			}
			o.push("</g>");
		});
		for (let t of e.edges) o.push(`<path data-edge="${R(e.id + ":" + t.t)}"${t.id ? ` data-edge-id="${R(t.id)}"` : ""} data-signal="${R(e.id)}" data-t="${t.t}" d="M ${t.x} ${e.y - 12} V ${e.y + 12}" stroke="${n}" stroke-width="2"/>`);
		o.push("</g>");
	});
	for (let e of n.linkRoutes) {
		let { link: t, points: n, label: r, dimension: i } = e, s = n.at(-1), c = n.at(-2), l = s.y > c.y ? 1 : -1;
		if (o.push(`<g data-link="${R(t.from + " -> " + t.to)}" data-from-edge="${R(t.from)}" data-to-edge="${R(t.to)}" data-route="${e.route}">`, `<path data-role="link-path" d="${n.map((e, t) => `${t ? "L" : "M"} ${e.x} ${e.y}`).join(" ")}" fill="none" stroke="#9b4d15"/>`, `<polygon data-role="link-arrow" points="${s.x},${s.y} ${s.x - 4},${s.y - l * 7} ${s.x + 4},${s.y - l * 7}" fill="#9b4d15"/>`), i) {
			let { x1: e, x2: t, y: n, delay: r } = i, a = Math.min(e, t), s = Math.max(e, t), c = Math.min(3, (s - a) / 3);
			o.push(`<g data-role="delay-dimension" data-delay="${r}" stroke="#9b4d15" stroke-width="0.7" fill="none">`, `<path d="M ${e} ${n - 10} V ${n + 4} M ${t} ${n - 10} V ${n + 4} M ${a} ${n} H ${s}"/>`), c && o.push(`<path d="M ${a + c} ${n - 2} L ${a} ${n} L ${a + c} ${n + 2} M ${s - c} ${n - 2} L ${s} ${n} L ${s - c} ${n + 2}"/>`), o.push("</g>");
		}
		r && o.push(a(r.text, r.x, r.y, "data-role=\"link-label\"")), o.push("</g>");
	}
	let s = new Map(n.markerLabels.map((e) => [e.id, e]));
	for (let e of n.document.markers ?? []) {
		let t = e.t ?? e.from, r = e.t ?? e.to;
		if (r < n.from || t > n.to) continue;
		o.push(`<g data-marker="${R(e.id)}">`), e.t === void 0 ? o.push(`<rect x="${i(Math.max(t, n.from))}" y="${n.top - 4}" width="${i(Math.min(r, n.to)) - i(Math.max(t, n.from))}" height="${n.plotBottom - n.top + 4}" fill="#fef08a" fill-opacity="0.2"/>`) : o.push(`<path d="M ${i(t)} 36 V ${n.plotBottom}" stroke="#be185d" stroke-dasharray="3 3"/>`);
		let c = s.get(e.id);
		c && o.push(a(e.label, c.x, c.y, "data-role=\"marker-label\"")), o.push("</g>");
	}
	return o.push("</svg>"), o.join("\n");
}
// src/lib/waveform/vcd.js
var ae = {
	s: 1000000000000000n,
	ms: 1000000000000n,
	us: 1000000000n,
	ns: 1000000n,
	ps: 1000n,
	fs: 1n
};
function U(e) {
	typeof e != "string" && m("timescale", "expected text");
	let t = /^(1|10|100)(s|ms|us|ns|ps|fs)$/.exec(e.replace(/\s+/g, ""));
	return t || m("timescale", "expected a VCD timescale such as 1ns or 10ps"), BigInt(t[1]) * ae[t[2]];
}
function W(e, t = {}) {
	return K(e, t, !1);
}
function G(e, t = {}) {
	return K(e, t, !0);
}
function K(e, t, n) {
	h(t, n ? [
		"maxBytes",
		"maxDeclarations",
		"maxChanges"
	] : [
		"signals",
		"from",
		"to",
		"timescale",
		"maxBytes",
		"maxSignals",
		"maxChanges",
		"maxDeclarations",
		"title"
	], "options"), typeof e != "string" && m("vcd", "expected text");
	let r = t.maxBytes ?? 16777216, i = t.maxDeclarations ?? 1e5, a = t.maxSignals ?? 256, o = t.maxChanges ?? 2e5;
	for (let [e, t] of Object.entries({
		maxBytes: r,
		maxSignals: a,
		maxChanges: o,
		maxDeclarations: i
	})) g(t, `options.${e}`, 1);
	(e.length > r || new TextEncoder().encode(e).length > r) && m("vcd", "input exceeds maxBytes"), t.signals !== void 0 && (!Array.isArray(t.signals) || t.signals.some((e) => typeof e != "string")) && m("options.signals", "expected a list of VCD names");
	let s = t.signals === void 0 ? null : new Set(t.signals), c = /* @__PURE__ */ new Set(), l = [], u = [], d = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Set(), p = e.matchAll(/\S+/g), _ = 0, v = () => (++_ > 2e6 && m("vcd", "token limit exceeded"), p.next().value?.[0]);
	function y() {
		let e = [], t;
		for (; (t = v()) !== void 0 && t !== "$end";) e.push(t);
		return t === void 0 && m("vcd", "unterminated directive"), e;
	}
	let b, S = 0, C, w = "tick", T = !1, E = 0, D = 0, O = !1;
	for (; (b = v()) !== void 0;) {
		if ([
			"$comment",
			"$date",
			"$version"
		].includes(b)) {
			y();
			continue;
		}
		if (b === "$timescale") {
			T && m("vcd", "timescale after definitions"), w = y().join(""), U(w);
			continue;
		}
		if (b === "$scope") {
			let e = y();
			(T || e.length !== 2) && m("vcd.scope", "invalid scope"), l.push(e[1]);
			continue;
		}
		if (b === "$upscope") {
			(y().length || !l.length || T) && m("vcd.scope", "unbalanced upscope"), l.pop();
			continue;
		}
		if (b === "$var") {
			let [e, t, r, p] = [
				v(),
				v(),
				v(),
				v()
			], h = v(), _ = h === "$end" ? [] : [h];
			h !== "$end" && v() !== "$end" && m("vcd.var", "unterminated declaration"), !T && ["wire", "reg"].includes(e) && r && p || m("vcd.var", "expected wire/reg width code reference"), /^\d+$/.test(t) || m("vcd.var.width", "expected integer width");
			let y = g(Number(t), "vcd.var.width", 1);
			y > 4096 && m("vcd.var.width", "maximum width is 4096"), (_.length > 1 || _.length && !/^\[-?\d+(?::-?\d+)?\]$/.test(_[0])) && m("vcd.var", "unsupported reference range");
			let b = [...l, p].join("."), x = b + _.join("");
			f.has(x) && m("vcd.var", "duplicate signal name " + x), f.add(x), f.size > i && m("vcd.var", "declaration count exceeds maxDeclarations");
			let S = !n && (!s || s.has(x) || s.has(b));
			s?.has(x) && c.add(x), s?.has(b) && c.add(b);
			let C = {
				type: e,
				width: y,
				name: x,
				reference: b,
				label: p + _.join(""),
				scope: l.join("."),
				selected: S,
				...S ? { changes: [[0, y === 1 ? "x" : "b" + "x".repeat(y)]] } : {}
			};
			S && ++D > o && m("vcd.changes", "initial values exceed maxChanges"), d.has(r) && d.get(r)[0].width !== y && m("vcd.var", "alias width disagrees"), d.has(r) || d.set(r, []), d.get(r).push(C), (S || n) && u.push(C), !n && u.length > a && m("vcd.signals", "selected lane count exceeds maxSignals");
			continue;
		}
		if (b === "$enddefinitions") {
			(y().length || l.length || T) && m("vcd", "invalid enddefinitions"), T = !0;
			continue;
		}
		if ([
			"$dumpvars",
			"$dumpall",
			"$dumpon",
			"$dumpoff"
		].includes(b)) {
			(!T || O) && m("vcd", "invalid dump block"), O = !0;
			continue;
		}
		if (b === "$end") {
			O || m("vcd", "unexpected $end"), O = !1;
			continue;
		}
		if (T || m("vcd", "expected declarations and $enddefinitions"), b.startsWith("#")) {
			/^#\d+$/.test(b) || m("vcd.time", "expected integer timestamp");
			let e = g(Number(b.slice(1)), "vcd.time");
			e < S && m("vcd.time", "time must not decrease"), C ??= e, S = e;
			continue;
		}
		C ??= S;
		let e, t;
		/^[01xz]/i.test(b) ? (t = b[0].toLowerCase(), e = b.slice(1)) : /^b[01xz]+$/i.test(b) ? (t = b.toLowerCase(), e = v()) : m("vcd.value", "unsupported value token " + b);
		let r = d.get(e);
		r || m("vcd.value", "unknown identifier code " + e), ++E > o && m("vcd.changes", "change count exceeds maxChanges");
		let p = r[0].width;
		if (t.startsWith("b")) {
			let e = t.slice(1);
			e.length > p && m("vcd.value", "vector exceeds declared width"), e = e.padStart(p, ["x", "z"].includes(e[0]) ? e[0] : "0"), t = p === 1 ? e === "0" ? 0 : e === "1" ? 1 : e : "b" + e;
		} else p !== 1 && m("vcd.value", "scalar change on a vector"), (t === "0" || t === "1") && (t = Number(t));
		for (let e of r) if (e.selected) {
			let n = e.changes, r = n.at(-1);
			r[0] === S ? r[1] = t : r[1] !== t && (++D > o && m("vcd.changes", "stored change count exceeds maxChanges"), n.push([S, t])), n.length > 1 && n.at(-1)[1] === n.at(-2)[1] && n.pop();
		}
	}
	if (T || m("vcd", "missing $enddefinitions"), O && m("vcd", "unterminated dump block"), n) return {
		signals: u.map(({ name: e, reference: t, width: n, type: r, scope: i }) => ({
			name: e,
			reference: t,
			width: n,
			type: r,
			scope: i
		})),
		timescale: w,
		firstTimestamp: C ?? 0,
		lastTimestamp: S
	};
	if (s) for (let e of s) c.has(e) || m("options.signals", "unknown VCD name " + e);
	let k = g(t.from ?? 0, "options.from"), A = g(t.to ?? Math.max(1, S), "options.to", 1);
	(k >= A || A > Math.max(1, S)) && m("options.to", "expected from < to within recorded duration");
	let j = t.timescale ?? w, M = j === w ? 1n : U(w), N = j === w ? 1n : U(j);
	function P(e) {
		let t = BigInt(e) * M;
		return t % N && m("options.timescale", "conversion produces fractional ticks"), g(Number(t / N), "converted time");
	}
	let F = /* @__PURE__ */ new Set(), I = u.map((e) => {
		let t = e.name.replace(/[^\w.-]/g, "_");
		/^[A-Za-z_]/.test(t) || (t = "signal_" + t);
		let n = t;
		for (let e = 2; F.has(t); e++) t = n + "_" + e;
		F.add(t);
		let r = e.changes.findLast((e) => e[0] <= k)[1];
		return {
			id: t,
			label: e.label,
			width: e.width,
			scope: e.scope,
			changes: [[0, r], ...e.changes.filter((e) => e[0] > k && e[0] <= A).map((e) => [P(e[0] - k), e[1]])]
		};
	});
	return x({
		format: "blockflow-waveform",
		version: 1,
		title: t.title ?? "Imported VCD",
		timescale: j,
		length: P(A - k),
		signals: I
	});
}
// src/agent-kit/edit-file.js
function q(e, t) {
	try {
		return JSON.parse(e.replace(/^\uFEFF/, ""));
	} catch (e) {
		throw Error(t + ": " + e.message, { cause: e });
	}
}
function oe(e, t) {
	let n = t.match(/\n([ \t]+)"/)?.[1] ?? (t.includes("\n") ? 2 : void 0), r = t.includes("\r\n") ? "\r\n" : "\n";
	return (t.startsWith("﻿") ? "﻿" : "") + JSON.stringify(e, null, n).replaceAll("\n", r) + (t.endsWith("\n") ? r : "");
}
async function se(e, r, s) {
	let l = e + ".blockflow-edit.lock", u = await t(l, "wx");
	try {
		let l = e + "." + c() + ".tmp", u = await t(l, "wx", (await a(e)).mode);
		try {
			try {
				await u.writeFile(oe(s, r), "utf8");
			} finally {
				await u.close();
			}
			if (await n(e, "utf8") !== r) throw Error("Diagram changed during apply: " + e);
			await i(l, e);
		} finally {
			await o(l).catch((e) => {
				if (e.code !== "ENOENT") throw e;
			});
		}
	} finally {
		await u.close(), await o(l);
	}
}
// src/agent-kit/waveform-edit.js
var J = "waveform-agent-kit-23be7e737990fd0d41d1";
function Y(e) {
	let t = x(e);
	return {
		document: t,
		edges: t.signals.flatMap((e) => e.changes.flatMap(([t, , n], r) => n && r > 0 ? [{
			id: n,
			signalId: e.id,
			t
		}] : [])),
		problems: C(t)
	};
}
async function X(t, n, a) {
	if (t === "-") {
		process.stdout.write(n);
		return;
	}
	let d = await r(t).catch((e) => {
		if (e.code === "ENOENT") return u(t);
		throw e;
	}), f = (e) => process.platform === "win32" ? e.toLowerCase() : e;
	if (f(d) === f(a)) throw Error("Output must differ from source file: " + t);
	await e(l(d), { recursive: !0 });
	let p = d + "." + c() + ".tmp";
	try {
		await s(p, n, { flag: "wx" }), await i(p, d);
	} finally {
		await o(p).catch((e) => {
			if (e.code !== "ENOENT") throw e;
		});
	}
}
var Z = "Usage:\n  node waveform-edit.mjs inspect waveform.json\n  node waveform-edit.mjs check waveform.json\n  node waveform-edit.mjs apply waveform.json --ops ops.json [--allow-problems] [--write]\n  node waveform-edit.mjs export waveform.json -o out.svg [--format svg|json] [--from N --to N --tick-step N] [--link-route auto|local|rail]\n  node waveform-edit.mjs vcd-list capture.vcd [--max-bytes N --max-declarations N --max-changes N]\n  node waveform-edit.mjs import-vcd capture.vcd [-o out.json] [--signals top.clk,top.data] [--from N --to N --timescale 1ns]\n  node waveform-edit.mjs --help | --version\napply (alias: edit) previews {diff,problems}; only --write replaces a validated waveform.\n--ops - reads JSON operations from stdin. --allow-problems permits draft diagnostics.\nexport/import-vcd -o - writes only the exported data to stdout. Source files are protected.", Q = { type: "string" }, ce = { type: "boolean" }, $ = {
	"max-bytes": Q,
	"max-declarations": Q,
	"max-changes": Q
}, le = {
	inspect: {},
	check: {},
	apply: {
		ops: Q,
		write: ce,
		"allow-problems": ce
	},
	export: {
		output: {
			...Q,
			short: "o"
		},
		format: Q,
		from: Q,
		to: Q,
		"tick-step": Q,
		"pixels-per-tick": Q,
		"lane-height": Q,
		"label-width": Q,
		"id-prefix": Q,
		"link-route": Q
	},
	"vcd-list": $,
	"import-vcd": {
		...$,
		output: {
			...Q,
			short: "o"
		},
		signals: Q,
		from: Q,
		to: Q,
		timescale: Q,
		title: Q,
		"max-signals": Q
	}
};
function ue(e, t) {
	let n = {};
	for (let r of t) if (e[r] !== void 0) {
		let t = r.replace(/-([a-z])/g, (e, t) => t.toUpperCase()), i = e[r];
		if ([
			"timescale",
			"title",
			"id-prefix",
			"link-route"
		].includes(r)) n[t] = i;
		else {
			if (!/^\d+(?:\.\d+)?$/.test(i) || !Number.isFinite(Number(i))) throw Error("--" + r + ": expected a nonnegative number");
			n[t] = Number(i);
		}
	}
	return n;
}
async function de(e) {
	if (e.length === 1 && [
		"--help",
		"-h",
		"--version"
	].includes(e[0])) {
		console.log(e[0] === "--version" ? J : Z);
		return;
	}
	let [t, ...i] = e;
	if (t === "edit" && (t = "apply"), !Object.hasOwn(le, t)) throw Error(Z);
	let { values: a, positionals: o } = f({
		args: i,
		allowPositionals: !0,
		options: le[t]
	});
	if (o.length !== 1) throw Error("Expected one input filename\n" + Z);
	let s = await r(o[0]), c = await n(s, "utf8");
	if (t === "vcd-list" || t === "import-vcd") {
		let e = ue(a, [...Object.keys($), ...t === "import-vcd" ? [
			"max-signals",
			"from",
			"to",
			"timescale",
			"title"
		] : []]);
		a.signals !== void 0 && (e.signals = a.signals.split(",").map((e) => e.trim()));
		let n = t === "vcd-list" ? G(c.replace(/^\uFEFF/, ""), e) : W(c.replace(/^\uFEFF/, ""), e), r = JSON.stringify(n, null, 2) + "\n";
		t === "import-vcd" ? await X(a.output ?? "-", r, s) : process.stdout.write(r);
		return;
	}
	let l = q(c, o[0]);
	if (t === "inspect" && console.log(JSON.stringify(Y(l), null, 2)), t === "check") {
		let e = C(l);
		console.log(JSON.stringify(e, null, 2)), e.length && (process.exitCode = 1);
	}
	if (t === "apply") {
		if (!a.ops) throw Error("apply requires --ops FILE or --ops -");
		let e = "";
		if (a.ops === "-") {
			process.stdin.setEncoding("utf8");
			for await (let t of process.stdin) e += t;
		} else e = await n(a.ops, "utf8");
		let t = L(l, q(e, a.ops), { allowProblems: a["allow-problems"] ?? !1 });
		a.write && t.diff.length && await se(s, c, t.document), console.log(JSON.stringify({
			diff: t.diff,
			problems: t.problems
		}, null, 2));
	}
	if (t === "export") {
		if (!a.output) throw Error("export requires -o FILE or -o -");
		let e = a.format ?? "svg";
		if (!["svg", "json"].includes(e)) throw Error("Unsupported format: " + e);
		let t = ue(a, [
			"from",
			"to",
			"tick-step",
			"pixels-per-tick",
			"lane-height",
			"label-width",
			"id-prefix",
			"link-route"
		]);
		if (e === "json" && Object.keys(t).length) throw Error("Rendering options require --format svg");
		let n = e === "svg" ? H(l, t) : JSON.stringify(x(l), null, 2);
		await X(a.output, n + "\n", s);
	}
}
if (process.argv[1] && d(u(process.argv[1])).href === import.meta.url) try {
	await de(process.argv.slice(2));
} catch (e) {
	console.error(e.message), process.exitCode = 1;
}
export { J as KIT_VERSION, p as WAVEFORM_FORMAT, L as applyWaveformOps, W as importVcd, Y as inspectWaveform, V as layoutWaveform, G as listVcdSignals, x as parseWaveform, H as renderWaveformSvg, T as snapWaveformTime, w as validateWaveform, C as waveformProblems };
