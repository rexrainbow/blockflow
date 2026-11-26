import { open as e, readFile as t, realpath as n, rename as r, stat as i, unlink as a } from "node:fs/promises";
import { randomUUID as o } from "node:crypto";
import { resolve as s } from "node:path";
import { pathToFileURL as c } from "node:url";
import { parseArgs as l } from "node:util";
// src/agent-kit/edit-file.js
function u(e, t) {
	try {
		return JSON.parse(e.replace(/^\uFEFF/, ""));
	} catch (e) {
		throw Error(t + ": " + e.message, { cause: e });
	}
}
function d(e, t) {
	let n = t.match(/\n([ \t]+)"/)?.[1] ?? (t.includes("\n") ? 2 : void 0), r = t.includes("\r\n") ? "\r\n" : "\n";
	return (t.startsWith("﻿") ? "﻿" : "") + JSON.stringify(e, null, n).replaceAll("\n", r) + (t.endsWith("\n") ? r : "");
}
async function f(n, s, c) {
	let l = n + ".blockflow-edit.lock", u = await e(l, "wx");
	try {
		let l = n + "." + o() + ".tmp", u = await e(l, "wx", (await i(n)).mode);
		try {
			try {
				await u.writeFile(d(c, s), "utf8");
			} finally {
				await u.close();
			}
			if (await t(n, "utf8") !== s) throw Error("Diagram changed during apply: " + n);
			await r(l, n);
		} finally {
			await a(l).catch((e) => {
				if (e.code !== "ENOENT") throw e;
			});
		}
	} finally {
		await u.close(), await a(l);
	}
}
// src/lib/blockchart/layout-defaults.js
var p = Object.freeze({
	blockMinWidth: 64,
	blockMinHeight: 36,
	blockPaddingX: 12,
	blockPaddingY: 8,
	blockPortCorner: 8,
	moduleSpacing: 20,
	layerSpacing: 30,
	inset: 8,
	titleGap: 6,
	portPitch: 16,
	edgeNode: 6,
	edgeEdge: 6
}), m = (e) => e.type ?? "container", h = (e) => typeof e == "string" ? e : e?.terminal === void 0 ? e?.moduleId === void 0 ? String(e) : `${e.moduleId}.${e.portId}` : `@terminal:${e.terminal}`, g = (e) => e.to, _ = (e) => e && typeof e == "object" && Object.hasOwn(e, "endpoint") ? e.endpoint : e;
function v(e, t) {
	e.connections = (e.connections ?? []).filter((e) => !t(e.from) && (e.to = e.to.filter((e) => !t(_(e))), e.to.length > 0));
}
// src/lib/blockchart/hierarchy.js
function ee(e, t) {
	return e.groups?.find((e) => e.members.includes(t))?.id ?? "";
}
function y(e, t) {
	let n = [], r = /* @__PURE__ */ new Set([t]);
	for (let i = ee(e, t); i && !r.has(i); i = ee(e, i)) r.add(i), n.unshift(i);
	return n;
}
function b(e, t) {
	let n = new Map((e.groups ?? []).map((e) => [e.id, e])), r = /* @__PURE__ */ new Set(), i = [...n.get(t)?.members ?? []];
	for (; i.length;) {
		let e = i.pop();
		r.has(e) || (r.add(e), i.push(...n.get(e)?.members ?? []));
	}
	return r;
}
// src/lib/blockchart/connectivity.js
var x = (e) => h(e.ref) + (e.isGroup && e.port.direction === "inout" ? e.inside ? ":inside" : ":outside" : ""), S = (e) => (e.groups ?? []).filter((e) => m(e) === "boundary");
function C(e) {
	let t = new Map((e.groups ?? []).map((e) => [e.id, e])), n = new Map((e.terminals ?? []).map((e) => [e.id, e])), r = new Map([
		...e.modules,
		...t.values(),
		...n.values()
	].map((e) => [e.id, e])), i = new Map([...r.keys()].map((t) => [t, y(e, t)])), a = /* @__PURE__ */ new Map();
	for (let e of r.values()) if (!(t.has(e.id) && m(e) !== "boundary")) for (let t of e.ports ?? []) a.set(e.id + "." + t.id, {
		owner: e,
		port: t
	});
	let o = (e, r) => {
		if (e && typeof e == "object" && !Array.isArray(e)) {
			if (Object.keys(e).length !== 1 || typeof e.terminal != "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.terminal) || e.terminal.trim() !== e.terminal) return {
				error: "Expected an endpoint object with only a terminal ID",
				field: r
			};
			let t = n.get(e.terminal);
			return t ? {
				owner: t,
				port: {
					...t,
					width: t.width ?? null,
					direction: t.direction === "input" ? "output" : "input"
				},
				ref: { terminal: t.id },
				isGroup: !1,
				isTerminal: !0
			} : {
				error: "Unknown terminal: " + e.terminal,
				field: r
			};
		}
		if (typeof e != "string" || /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.exec(e)?.[0] !== e) return {
			error: "Expected moduleId.portId",
			field: r
		};
		let i = a.get(e);
		return i ? {
			...i,
			ref: {
				moduleId: i.owner.id,
				portId: i.port.id
			},
			isGroup: t.has(i.owner.id)
		} : {
			error: "Unknown port: " + e,
			field: r
		};
	};
	return { resolve(n, r, a = "forward") {
		let s = o(n, "from");
		if (s.error) return s;
		let c = o(r, "to");
		if (c.error) return c;
		if (s.isTerminal && c.isTerminal) return {
			error: "A terminal connection must have a real port at the other end",
			field: "to"
		};
		if (a === "both" && (s.isTerminal || c.isTerminal || s.port.direction !== "inout" || c.port.direction !== "inout")) return {
			error: "Bidirectional connections require two inout ports",
			field: "to"
		};
		let l = s.isGroup && s.owner.id === c.owner.id && s.port.direction === "input" && c.port.direction === "output", u = (e, t) => e.isGroup && (e.owner.id === t.owner.id ? l : i.get(t.owner.id).includes(e.owner.id));
		s.inside = u(s, c), c.inside = u(c, s);
		for (let [e, t, n] of [[
			s,
			"from",
			s.inside ? "input" : "output"
		], [
			c,
			"to",
			c.inside ? "output" : "input"
		]]) if (e.port.direction !== "inout" && e.port.direction !== n) return {
			error: `Expected ${n} port${e.isGroup ? " on the " + (e.inside ? "inside" : "outside") + " of group " + e.owner.id : ""}`,
			field: t
		};
		for (let t of S(e)) if (i.get(s.owner.id).includes(t.id) !== i.get(c.owner.id).includes(t.id) && s.owner.id !== t.id && c.owner.id !== t.id) return {
			error: `Connection crosses boundary of group ${t.id}; connect through its ports`,
			field: "to"
		};
		let d = [...i.get(s.owner.id), ...s.inside ? [s.owner.id] : []], f = [...i.get(c.owner.id), ...c.inside ? [c.owner.id] : []], p = "";
		for (let e = 0; e < Math.min(d.length, f.length) && d[e] === f[e]; e++) p = d[e];
		let h = p ? [...i.get(p), p] : [];
		return {
			source: s,
			target: c,
			scope: p,
			insideSelfLoop: l,
			boundaryScoped: h.some((e) => t.has(e) && m(t.get(e)) === "boundary")
		};
	} };
}
// src/lib/shared/text.js
var w = Object.freeze({
	color: "#000000",
	fontSize: 12,
	backgroundColor: "#00000000",
	padding: 0,
	opacity: 1,
	backgroundOpacity: 1,
	hidden: !1
}), te = Object.freeze({
	...w,
	borderColor: "#00000000",
	borderWidth: 1,
	borderOpacity: 1,
	borderRadius: 0,
	repeatAtEnd: "auto",
	longThreshold: 600
}), T = Object.freeze({
	borderColor: "#000000",
	borderWidth: 1,
	borderStyle: "solid",
	borderOpacity: 1,
	fillColor: "#ffffff",
	fillOpacity: 1
}), E = Object.freeze({
	...T,
	borderColor: "#8793a5",
	borderStyle: "dashed",
	fillColor: "#f7f9fc",
	borderRadius: 0
}), ne = (e) => ({
	strokeColor: "#000000",
	strokeWidth: e > 1 ? 2.5 : 1.5,
	lineStyle: "solid",
	opacity: 1,
	endArrow: "none",
	startArrow: "none"
}), D = [
	"label",
	"portLabel",
	"inputPortLabel",
	"outputPortLabel"
], re = {
	text: [...Object.keys(w), "textAlign"],
	connectionLabel: [...Object.keys(te), "textAlign"],
	group: [...Object.keys(E), ...D],
	connection: [...Object.keys(ne(1)), "label"],
	module: [...Object.keys(T), ...D],
	diagram: [
		"text",
		"module",
		"group",
		"connection",
		"terminal",
		"caption"
	]
};
function O(e, t, n, r) {
	(!e || typeof e != "object" || Array.isArray(e)) && r("Expected a style object", n);
	let i = {};
	for (let [a, o] of Object.entries(e)) {
		let e = `${n}.${a}`;
		if (re[t].includes(a) || r(`Unsupported style property: ${a}`, e), t === "diagram" || ["module", "group"].includes(t) && D.includes(a) || ["group", "connection"].includes(t) && a === "label") i[a] = O(o, t === "diagram" ? [
			"text",
			"terminal",
			"caption"
		].includes(a) ? "text" : a : t === "connection" ? "connectionLabel" : "text", e, r);
		else if (t === "connectionLabel" && a === "repeatAtEnd") {
			let t = [
				"auto",
				"always",
				"never"
			];
			t.includes(o) || r(`Expected ${t.join(", ")}`, e), i[a] = o;
		} else if (a === "textAlign") [
			"left",
			"center",
			"right"
		].includes(o) || r("Expected left, center or right", e), i[a] = o;
		else if (a === "hidden") typeof o != "boolean" && r("Expected a boolean", e), i[a] = o;
		else if (a === "endArrow" || a === "startArrow") ["none", "triangle"].includes(o) || r("Expected none or triangle arrow", e), i[a] = o;
		else if (a.toLowerCase().endsWith("color")) o === "transparent" ? i[a] = "#00000000" : ((typeof o != "string" || /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(o)?.[0] !== o) && r("Expected hex color or transparent", e), i[a] = (o.length <= 5 ? "#" + [...o.slice(1)].map((e) => e + e).join("") : o).toLowerCase());
		else if (a === "lineStyle" || a === "borderStyle") [
			"solid",
			"dashed",
			"dotted"
		].includes(o) || r("Expected solid, dashed or dotted", e), i[a] = o;
		else {
			let n = a.toLowerCase().endsWith("opacity"), s = n || a === "padding" || a === "borderRadius" || t === "connectionLabel" && a === "borderWidth";
			(typeof o != "number" || !Number.isFinite(o) || (s ? o < 0 : o <= 0) || n && o > 1) && r(n ? "Expected opacity between 0 and 1" : `Expected finite ${s ? "non-negative" : "positive"} number`, e), i[a] = o;
		}
	}
	return i;
}
function k(e = {}, t, n = "", r = {}, i = {}) {
	let a = [], o = (e, t) => {
		e && a.push({
			value: e,
			source: t
		});
	}, s = [
		"text",
		"terminal",
		"caption",
		"port"
	].includes(t) || !!n;
	o(s ? t === "connection" ? te : w : t === "group" ? E : t === "module" ? T : {
		...ne(i.width),
		endArrow: "triangle",
		...i.direction === "both" ? { startArrow: "triangle" } : {}
	}, "Built-in"), s && t !== "text" && o(e.text, "Diagram > Text");
	let c = {
		module: "Blocks",
		group: "Groups",
		connection: "Connections",
		terminal: "Terminals",
		caption: "Caption",
		text: "Text"
	}, l = {
		label: "Label",
		portLabel: "All ports",
		inputPortLabel: "Input labels",
		outputPortLabel: "Output labels"
	};
	if (t === "port") {
		let t = i.direction ?? "input", n = t === "inout" ? null : t === "input" ? "inputPortLabel" : "outputPortLabel";
		for (let [t, r] of [
			[e.module, "Diagram > Blocks"],
			...i.ownerKind === "group" ? [[e.group, "Diagram > Groups"]] : [],
			[i.ownerStyle, i.ownerLabel ?? "Owner"]
		]) o(t?.portLabel, r + " > All ports"), n && o(t?.[n], r + " > " + l[n]);
		return o(r, "This port"), a;
	}
	return [
		"portLabel",
		"inputPortLabel",
		"outputPortLabel"
	].includes(n) ? (t === "group" && (o(e.module?.portLabel, "Diagram > Blocks > All ports"), n !== "portLabel" && o(e.module?.[n], "Diagram > Blocks > " + l[n])), o(e[t]?.portLabel, "Diagram > " + c[t] + " > All ports"), n !== "portLabel" && o(e[t]?.[n], "Diagram > " + c[t] + " > " + l[n]), o(r.portLabel, "This object > All ports"), n !== "portLabel" && o(r[n], "This object > " + l[n]), a) : (o(n ? e[t]?.[n] : e[t], "Diagram > " + c[t] + (n ? " > " + l[n] : "")), i.netStyle && o(n ? i.netStyle[n] : i.netStyle, "This Net"), o(n ? r[n] : r, "This object"), a);
}
var A = (e) => Object.assign({}, ...e.map((e) => e.value));
function j(e = {}, t = {}, n = {}) {
	let r = {
		module: e,
		text: n
	}, i = A(k(r, "module", "", t));
	return {
		...Object.fromEntries(Object.keys(T).map((e) => [e, i[e]])),
		label: A(k(r, "module", "label", t))
	};
}
function ie(e = {}, t = {}, n, r = {}, i = void 0) {
	return A(k({
		module: e,
		text: r,
		group: i
	}, "port", "", n.style, {
		direction: n.direction,
		ownerStyle: t,
		ownerKind: i ? "group" : "module"
	}));
}
function M(e = {}, t = {}, n = {}) {
	let r = {
		group: t,
		text: n
	}, i = A(k(r, "group", "", e));
	return {
		...Object.fromEntries(Object.keys(E).map((e) => [e, i[e]])),
		label: A(k(r, "group", "label", e))
	};
}
// src/lib/blockchart/appearances.js
var N = (e) => e;
function P(e, t) {
	let n = t.stroke / 2, r = Object.fromEntries([...t.inputs, ...t.outputs].map((n) => [n.id, {
		x: n.direction === "input" ? 0 : e.width,
		y: n.direction === "input" || t.outputs.length > 1 ? e.rowCenters[n.order] : (e.rowCenters[0] + e.rowCenters.at(-1)) / 2
	}]));
	return {
		...e,
		portPoints: r,
		body: {
			type: "bar",
			shapes: [{
				kind: "rect",
				x: n,
				y: n,
				width: e.width - t.stroke,
				height: e.height - t.stroke
			}]
		}
	};
}
function F(e, t, n) {
	let r = n.layers, i = r * 6, a = t.stroke / 2, o = [];
	for (let n = r; n >= 0; n--) o.push({
		kind: "rect",
		x: n * 6 + a,
		y: n * 6 + a,
		width: e.width - t.stroke,
		height: e.height - t.stroke
	});
	return {
		...e,
		width: e.width + i,
		height: e.height + i,
		titleX: e.width / 2,
		outputLabelInset: e.portInset + i,
		body: {
			type: "stacked",
			shapes: o
		}
	};
}
function I(e, t, n) {
	let r = n.rightHeightRatio, i = 12 + t.border, a = Math.max(e.width, t.titleWidth + 2 * Math.max(0, ...t.inputs.map((e) => e.width), ...t.outputs.map((e) => e.width)) + 48 + 2 * t.border), o = (e) => e.reduce((e, t) => e + t.height, 0) + 12 * (e.length + 1) + 2 * i, s = Math.max(0, ...t.inputs.map((e) => e.width)), c = s ? Math.min(1, (e.portInset + s) / a) : 0, l = 1 - (1 - r) * c, u = Math.max(e.height, (t.titleHeight + 2 * i) / r, o(t.inputs) / l, o(t.outputs) / r), d = u * (1 - r) / 2, f = Object.create(null);
	for (let [e, n, o, s] of [[
		t.inputs,
		d * c,
		u * l,
		0
	], [
		t.outputs,
		d,
		u * r,
		a
	]]) {
		let t = e.reduce((e, t) => e + t.height, 0), r = (o - 2 * i - t) / (e.length + 1), a = n + i + r;
		for (let t of e) f[t.id] = {
			x: s,
			y: a + t.height / 2
		}, a += t.height + r;
	}
	let p = t.stroke / 2;
	return {
		...e,
		width: a,
		height: u,
		titleX: a / 2,
		titleY: u / 2,
		portPoints: f,
		body: {
			type: "trapezoid",
			shapes: [{
				kind: "polygon",
				points: [
					{
						x: p,
						y: p
					},
					{
						x: a - p,
						y: d + p
					},
					{
						x: a - p,
						y: u - d - p
					},
					{
						x: p,
						y: u - p
					}
				]
			}]
		}
	};
}
var L = Object.freeze({
	rectangle: {
		keys: ["type"],
		defaults: {},
		geometry: N
	},
	bar: {
		keys: ["type"],
		defaults: {},
		geometry: P
	},
	stacked: {
		keys: ["type", "layers"],
		defaults: { layers: 2 },
		geometry: F
	},
	trapezoid: {
		keys: ["type", "rightHeightRatio"],
		defaults: { rightHeightRatio: .6 },
		geometry: I
	}
});
function ae(e, t, n) {
	(!e || typeof e != "object" || Array.isArray(e)) && n("Expected an appearance object", t), Object.hasOwn(L, e.type) || n("Expected rectangle, bar, stacked or trapezoid appearance", `${t}.type`);
	let r = L[e.type];
	for (let i of Object.keys(e)) r.keys.includes(i) || n("Unsupported appearance property: " + i, `${t}.${i}`);
	let i = {
		...r.defaults,
		...e
	};
	return e.type === "stacked" && (!Number.isInteger(i.layers) || i.layers < 1 || i.layers > 3) && n("Stack layers must be an integer from 1 to 3", `${t}.layers`), e.type === "trapezoid" && (typeof i.rightHeightRatio != "number" || !Number.isFinite(i.rightHeightRatio) || i.rightHeightRatio < .2 || i.rightHeightRatio > 1) && n("Right height ratio must be between 0.2 and 1", `${t}.rightHeightRatio`), i;
}
// src/lib/blockchart/grid.js
function R(e, t, n = []) {
	let r = new Map(t.map((e) => [e.id, e]));
	return e.flatMap((e) => n.includes(e) ? r.get(e)?.members ?? [] : [e]);
}
function z(e, t, n, r = "layout", i = (e) => {
	throw Error(e);
}) {
	let a = [];
	for (let o of t) {
		let t = n.find((e) => e.id === o), s = new Set(t.members), c = [];
		e.forEach((e, t) => e.forEach((e, n) => {
			s.has(e) && c.push({
				r: t,
				c: n
			});
		})), c.length !== s.size && i(`Expanded container ${o} requires every direct member in the Grid`, `${r}.cells[${c[0]?.r ?? 0}][${c[0]?.c ?? 0}]`);
		let l = {
			id: o,
			firstRow: Math.min(...c.map((e) => e.r)),
			lastRow: Math.max(...c.map((e) => e.r)),
			firstColumn: Math.min(...c.map((e) => e.c)),
			lastColumn: Math.max(...c.map((e) => e.c))
		};
		for (let t = l.firstRow; t <= l.lastRow; t++) for (let n = l.firstColumn; n <= l.lastColumn; n++) e[t][n] !== null && !s.has(e[t][n]) && i(`Container ${o} must occupy a rectangle without outside members`, `${r}.cells[${t}][${n}]`);
		a.some((e) => l.firstRow <= e.lastRow && l.lastRow >= e.firstRow && l.firstColumn <= e.lastColumn && l.lastColumn >= e.firstColumn) && i("Expanded container regions must not overlap", `${r}.cells[${c[0]?.r ?? 0}][${c[0]?.c ?? 0}]`), a.push(l);
	}
	return a;
}
function B(e, t, n = [], r = "layout", i = oe) {
	Array.isArray(e) && e.length && Array.isArray(e[0]) && e[0].length || i("Grid needs at least one row and column", r + ".cells");
	let a = e[0].length, o = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Map();
	for (let [t, n] of e.entries()) {
		Array.isArray(n) && n.length === a || i("Grid rows must have equal column counts", `${r}.cells[${t}]`);
		for (let [e, a] of n.entries()) {
			if (a === null) continue;
			let n = `${r}.cells[${t}][${e}]`;
			typeof a != "string" && i("Grid cells must contain member IDs or null", n), o.has(a) && i("A member may occur only once in a grid: " + a, n), o.add(a), s.set(a, n);
		}
	}
	let c = n.filter((e) => t.includes(e.id) && m(e) === "container" && !e.collapsed && e.members.length).filter((e) => e.members.some((e) => o.has(e))).map((e) => e.id);
	for (let e of c) o.has(e) && i(`Container ${e} and its children cannot occur in the same Grid`, s.get(e));
	let l = new Set(R(t, n, c));
	for (let [e, t] of s) l.has(e) || i("Grid cells must reference direct members or direct children of nonempty Containers: " + e, t);
	for (let e of c) {
		let t = n.find((t) => t.id === e), r = t.members.filter((e) => !o.has(e));
		r.length && i(`Expanded container ${e} requires every direct member in the Grid; missing: ${r.join(", ")}`, s.get(t.members.find((e) => o.has(e))));
	}
	return {
		expandedContainers: c,
		regions: z(e, c, n, r, i)
	};
}
function oe(e, t) {
	let n = Error(e);
	throw n.path = t, n;
}
function se(e, t, n, r, i = !1, a = []) {
	(!e || typeof e != "object" || Array.isArray(e)) && r("Expected a layout object", n), Object.hasOwn(e, "expandGroups") && r("Remove expandGroups; Container expansion is inferred from cells", n + ".expandGroups");
	let o = e.type ?? "auto";
	if ((!["auto", "grid"].includes(o) || Object.hasOwn(e, "type") && !["auto", "grid"].includes(e.type)) && r("Expected auto or grid layout", n + ".type"), !i) for (let t of Object.keys(e)) [
		"type",
		"cells",
		"rowGap",
		"columnGap",
		"moduleSpacing",
		"layerSpacing",
		"blockMinWidth",
		"blockMinHeight",
		"blockAlign"
	].includes(t) || r("Unsupported grid property: " + t, n + "." + t);
	let s = {};
	Object.hasOwn(e, "blockAlign") && (o !== "grid" && r("Block alignment requires type grid", n + ".blockAlign"), [
		"left",
		"center",
		"right"
	].includes(e.blockAlign) || r("Expected left, center or right Block alignment", n + ".blockAlign"), s.blockAlign = e.blockAlign);
	let c = {}, l = {};
	for (let t of ["blockMinWidth", "blockMinHeight"]) Object.hasOwn(e, t) && (o !== "grid" && r("Block minimums require type grid", n + "." + t), (typeof e[t] != "number" || !Number.isFinite(e[t]) || e[t] <= 0) && r("Block minimum must be finite and positive", n + "." + t), l[t] = e[t]);
	if (!i) for (let t of ["moduleSpacing", "layerSpacing"]) Object.hasOwn(e, t) && ((typeof e[t] != "number" || !Number.isFinite(e[t]) || e[t] <= 0) && r("Spacing must be finite and positive", n + "." + t), c[t] = e[t]);
	for (let t of ["rowGap", "columnGap"]) Object.hasOwn(e, t) && (typeof e[t] != "number" || !Number.isFinite(e[t]) || e[t] < 0) && r("Grid gap must be finite and non-negative", n + "." + t);
	return o === "auto" ? (Object.hasOwn(e, "cells") && r("Grid cells require type grid", n + ".cells"), {
		type: o,
		...c
	}) : (B(e.cells, t, a, n, r), {
		type: o,
		...c,
		...l,
		...s,
		cells: structuredClone(e.cells),
		rowGap: e.rowGap ?? 50,
		columnGap: e.columnGap ?? 80
	});
}
function ce(e, t, n) {
	for (let r of [e.layout, ...(e.groups ?? []).map((e) => e.layout)]) r?.cells && (r.cells = r.cells.map((e) => e.map((e) => e === t ? n : e)));
}
// src/lib/blockchart/model.js
var le = /^[A-Za-z_][A-Za-z0-9_]*$/, V = (e, t) => Object.hasOwn(e, t), ue = class extends Error {
	constructor(e, t) {
		super(e), this.name = "DiagramValidationError", this.path = t;
	}
};
function H(e, t) {
	throw new ue(e, t);
}
function de(e) {
	try {
		fe(e);
	} catch (e) {
		throw e.stage ??= "validation", e;
	}
	return { ok: !0 };
}
function U(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && H("Expected an object", n);
	for (let r of Object.keys(e)) t.includes(r) || H(`Unsupported property: ${r}`, n ? `${n}.${r}` : r);
}
function W(e, t, n = !1) {
	typeof e == "string" && e.trim() || H("Expected a non-empty string", t), n && (e = e.replace(/\r\n/g, "\n"));
	for (let r of e) {
		let e = r.codePointAt(0);
		(e < 32 && !(n && e === 10) || e >= 55296 && e <= 57343 || e === 65534 || e === 65535 || e === 8232 || e === 8233) && H(n ? "Expected XML-compatible display text" : "Expected single-line XML-compatible text", t);
	}
	return e;
}
function G(e, t) {
	return (typeof e != "string" || le.exec(e)?.[0] !== e) && H("Invalid ID", t), e;
}
function K(e, t, n = 0) {
	(!Array.isArray(e) || e.length < n) && H(`Expected array with at least ${n} item(s)`, t);
}
function q(e, t) {
	return (typeof e != "number" || !Number.isFinite(e) || e <= 0) && H("Expected a finite positive number", t), e;
}
function fe(e) {
	U(e, [
		"version",
		"diagram",
		"modules",
		"connections",
		"groups",
		"terminals",
		"layout"
	], ""), e.version !== 1 && H("Only version 1 is supported", "version"), U(e.diagram, [
		"name",
		"style",
		"caption"
	], "diagram");
	let t = {
		name: W(e.diagram.name, "diagram.name"),
		...V(e.diagram, "caption") ? { caption: W(e.diagram.caption, "diagram.caption", !0) } : {},
		style: V(e.diagram, "style") ? O(e.diagram.style, "diagram", "diagram.style", H) : {}
	};
	K(e.modules, "modules", Array.isArray(e.groups) && e.groups.length ? 0 : 1);
	let n = /* @__PURE__ */ new Set();
	function r(n, r, i, a = !1) {
		let o = /* @__PURE__ */ new Set(), s = {
			input: 0,
			output: 0,
			inout: 0
		};
		return n.map((n, c) => {
			let l = `${r}[${c}]`;
			U(n, [
				"id",
				"label",
				"direction",
				"width",
				"style",
				"side"
			], l);
			let u = G(n.id, `${l}.id`);
			o.has(u) && H("Duplicate port ID", `${l}.id`), o.add(u), [
				"input",
				"output",
				"inout"
			].includes(n.direction) || H("Unsupported port direction", `${l}.direction`), V(n, "side") && ![
				"left",
				"right",
				"top",
				"bottom"
			].includes(n.side) && H("Expected left, right, top or bottom", l + ".side");
			let d = V(n, "style") ? O(n.style, "text", `${l}.style`, H) : {}, f = V(n, "width") ? n.width : null;
			V(n, "width") && (!Number.isSafeInteger(f) || f <= 0) && H("Expected a positive safe integer", `${l}.width`);
			let p = V(n, "label") ? W(n.label, `${l}.label`, !0) : u;
			return {
				id: u,
				direction: n.direction,
				width: f,
				displayName: f > 1 ? `${p}[${f - 1}:0]` : p,
				side: V(n, "side") ? n.side : e.layout?.direction === "down" ? n.direction === "input" ? "top" : "bottom" : n.direction === "input" ? "left" : "right",
				order: s[n.direction]++,
				style: ie(t.style.module, i, {
					direction: n.direction,
					style: d
				}, t.style.text, a ? t.style.group ?? {} : void 0)
			};
		});
	}
	let i = e.modules.map((i, a) => {
		let o = `modules[${a}]`;
		U(i, [
			"id",
			"label",
			"ports",
			"style",
			"width",
			"height",
			"appearance",
			"type"
		], o);
		let s = i.type ?? "block";
		V(i, "type") && !["block", "concat"].includes(i.type) && H("Expected block or concat", `${o}.type`);
		let c = V(i, "style") ? O(i.style, "module", `${o}.style`, H) : {}, l = G(i.id, `${o}.id`);
		n.has(l) && H("Duplicate module ID", `${o}.id`), n.add(l);
		let u = V(i, "label") ? W(i.label, `${o}.label`, !0) : l;
		V(i, "ports") && K(i.ports, `${o}.ports`);
		let d = r(i.ports ?? [], `${o}.ports`, c);
		if (s === "concat") {
			let t = d.filter((e) => e.direction === "input"), n = d.filter((e) => e.direction === "output");
			d.some((e) => e.direction === "inout") && H("Concat cannot have bidirectional ports", o + ".ports"), t.length && n.length === 1 || H("Concat requires at least one input and exactly one output", `${o}.ports`);
			let r = e.layout?.direction === "down";
			for (let [e, t] of d.entries()) {
				let n = r ? t.direction === "input" ? "top" : "bottom" : t.direction === "input" ? "left" : "right";
				t.side !== n && H(`Concat ${t.direction} ports must use the ${n} side for this Flow; omit side to follow Flow`, `${o}.ports[${e}].side`);
			}
			V(i, "appearance") && i.appearance?.type !== "bar" && H("Concat has a fixed bar appearance; omit appearance or use bar", `${o}.appearance`), d.every((e) => e.width !== null) && t.reduce((e, t) => e + BigInt(t.width), 0n) !== BigInt(n[0].width) && H("Concat output width must equal the sum of all input widths", `${o}.ports`);
		}
		return {
			id: l,
			label: u,
			ports: d,
			...V(i, "type") ? { type: s } : {},
			...V(i, "appearance") ? { appearance: ae(i.appearance, `${o}.appearance`, H) } : {},
			...V(i, "width") ? { width: q(i.width, `${o}.width`) } : {},
			...V(i, "height") ? { height: q(i.height, `${o}.height`) } : {},
			style: j(t.style.module, c, t.style.text)
		};
	}), a = V(e, "groups") ? e.groups : [];
	K(a, "groups");
	let o = /* @__PURE__ */ new Set();
	for (let [e, t] of a.entries()) {
		U(t, [
			"id",
			"label",
			"members",
			"style",
			"type",
			"ports",
			"collapsed",
			"width",
			"height",
			"layout"
		], `groups[${e}]`);
		let r = G(t.id, `groups[${e}].id`);
		(n.has(r) || o.has(r)) && H("Group ID must be unique across blocks and groups", `groups[${e}].id`), o.add(r);
	}
	let s = /* @__PURE__ */ new Set(), c = a.map((e, i) => {
		let a = `groups[${i}]`;
		U(e, [
			"id",
			"label",
			"members",
			"style",
			"type",
			"ports",
			"collapsed",
			"width",
			"height",
			"layout"
		], a);
		let c = G(e.id, `${a}.id`);
		K(e.members, `${a}.members`);
		let l = e.members.map((e, t) => {
			let r = `${a}.members[${t}]`;
			return !n.has(e) && !o.has(e) && H("Unknown group member: " + e, r), s.has(e) && H("An item may belong to only one group", r), s.add(e), e;
		}), u = V(e, "style") ? O(e.style, "group", `${a}.style`, H) : {}, d = V(e, "type") ? e.type : "container";
		[
			"container",
			"boundary",
			"collection"
		].includes(d) || H("Expected container, boundary or collection group type", `${a}.type`);
		let f = V(e, "collapsed") ? e.collapsed : !1;
		typeof f != "boolean" && H("Expected a boolean", `${a}.collapsed`), f && d === "container" && H("Only boundary or collection groups may hide contents", `${a}.collapsed`);
		let p = V(e, "ports") ? e.ports : [];
		K(p, `${a}.ports`);
		let m = r(p, `${a}.ports`, u, !0);
		return {
			id: c,
			label: V(e, "label") ? W(e.label, `${a}.label`, !0) : c,
			members: l,
			type: d,
			portMode: d === "boundary" ? "boundary" : "direct",
			ports: m,
			collapsed: f,
			...d === "collection" ? { portLabelStyle: u } : {},
			...V(e, "width") ? { width: q(e.width, `${a}.width`) } : {},
			...V(e, "height") ? { height: q(e.height, `${a}.height`) } : {},
			style: M(u, t.style.group, t.style.text)
		};
	}), l = new Map(c.flatMap((e) => e.members.map((t) => [t, e.id])));
	for (let [e, t] of c.entries()) {
		let n = /* @__PURE__ */ new Set();
		for (let r = t.id; r; r = l.get(r)) n.has(r) && H("Group hierarchy contains a cycle", `groups[${e}].members`), n.add(r);
	}
	let u = V(e, "terminals") ? e.terminals : [];
	K(u, "terminals");
	let d = /* @__PURE__ */ new Set(), f = {
		input: 0,
		output: 0
	}, m = u.map((e, r) => {
		let i = `terminals[${r}]`;
		U(e, [
			"id",
			"direction",
			"label",
			"width",
			"style"
		], i);
		let a = G(e.id, `${i}.id`);
		(n.has(a) || o.has(a) || d.has(a)) && H("Terminal ID must be unique across blocks, groups and terminals", `${i}.id`), d.add(a), ["input", "output"].includes(e.direction) || H("Unsupported terminal direction", `${i}.direction`);
		let s = V(e, "width") ? e.width : null;
		V(e, "width") && (!Number.isSafeInteger(s) || s <= 0) && H("Expected a positive safe integer", `${i}.width`);
		let c = V(e, "label") ? W(e.label, `${i}.label`, !0) : a, l = V(e, "style") ? O(e.style, "text", `${i}.style`, H) : {};
		return {
			id: a,
			direction: e.direction,
			label: c,
			displayName: s > 1 ? `${c}[${s - 1}:0]` : c,
			width: s,
			order: f[e.direction]++,
			style: {
				...w,
				...t.style.text,
				...t.style.terminal,
				...l
			}
		};
	}), v = V(e, "connections") ? e.connections : [];
	K(v, "connections");
	let ee = /* @__PURE__ */ new Set(), y = /* @__PURE__ */ new Map(), b = /* @__PURE__ */ new Map(), T = /* @__PURE__ */ new Set(), E = /* @__PURE__ */ new Map(), D = C({
		modules: i,
		groups: c,
		terminals: m
	}), re = S({ groups: c }).length > 0, k = v.flatMap((e, n) => {
		let r = `connections[${n}]`;
		U(e, [
			"id",
			"from",
			"to",
			"feedback",
			"label",
			"style",
			"direction",
			"constraint"
		], r), K(e.to, r + ".to", 1);
		let i = V(e, "id") ? G(e.id, r + ".id") : `connection_${n}`;
		T.has(i) && H("Duplicate connection ID", r + ".id"), T.add(i);
		let a = g(e);
		a.length || H("Net requires at least one target", r + ".to");
		let o = V(e, "style") ? O(e.style, "connection", r + ".style", H) : {}, s = e.direction ?? "forward";
		V(e, "direction") && !["forward", "both"].includes(e.direction) && H("Expected forward or both", r + ".direction");
		let c = V(e, "label") ? W(e.label, r + ".label", !0) : void 0, l = /* @__PURE__ */ new Set(), u = /* @__PURE__ */ new Set(), d, f = a.map((f, p) => {
			let m = `${r}.to[${p}]`, g = f && typeof f == "object" && V(f, "endpoint");
			g && U(f, [
				"endpoint",
				"constraint",
				"feedback",
				"style"
			], m);
			let v = _(f), S = h(v);
			S === h(e.from) && H("Target must differ from the main endpoint", m), l.has(S) && H("Duplicate net target", m), l.add(S);
			let C = D.resolve(e.from, v, s);
			C.error && H(C.error, C.field === "from" ? r + ".from" : m);
			let { source: w, target: T } = C;
			for (let e of [w, T]) e.port.width !== null && e.port.width !== void 0 && u.add(e.port.width);
			let k = h(e.from) + "->" + S;
			ee.has(k) && H("Duplicate connection", m), ee.add(k);
			let A = x(w), j = x(T);
			d !== void 0 && d !== A && H("Use separate Nets for inside and outside boundary-port faces", m), d = A;
			for (let e of [A, j]) E.has(e) && E.get(e) !== i && H("Port already has a driver or belongs to another net", m);
			s === "both" && (b.has(j) && b.get(j).id !== i && H("Port already has a driver or belongs to another net", m), E.set(A, i), E.set(j, i));
			let ie = b.get(A);
			ie && ie.id !== i && H("Source already belongs to another net; add its target to that net", r + ".from"), b.set(A, { id: i }), y.has(j) && y.get(j) !== i && H("Input already has a driver", m), s === "both" && y.has(A) && y.get(A) !== i && H("Port already has a driver or belongs to another net", r + ".from"), w.port.direction === "inout" && y.has(A) && y.get(A) !== i && H("Port already has a driver or belongs to another net", r + ".from"), y.set(j, i), s === "both" && y.set(A, i);
			let M = g && V(f, "style") ? O(f.style, "connection", m + ".style", H) : {};
			V(M, "label") && H("Net label styles belong to the whole connection", m + ".style.label"), V(M, "startArrow") && H("Net source arrow belongs to the whole connection", m + ".style.startArrow");
			let N = g && V(f, "feedback") ? f.feedback : V(e, "feedback") ? e.feedback : !1, P = g && V(f, "constraint") ? f.constraint : !V(e, "constraint") || e.constraint;
			typeof N != "boolean" && H("Expected a boolean", r + ".feedback"), typeof P != "boolean" && H("Expected a boolean", r + ".constraint");
			let F = w.port.width ?? T.port.width, I = {
				...ne(F),
				endArrow: "triangle",
				...s === "both" ? {
					startArrow: "triangle",
					endArrow: "triangle"
				} : {},
				...t.style.connection,
				...o,
				...c !== void 0 || t.style.connection?.label || o.label ? { label: {
					...te,
					...t.style.text,
					...t.style.connection?.label,
					...o.label
				} } : {}
			};
			return {
				...c === void 0 ? {} : { label: c },
				id: a.length === 1 ? `connection_${n}` : `connection_${n}_branch_${p}`,
				source: w.ref,
				target: T.ref,
				width: F,
				feedback: N,
				netId: i,
				connectionIndex: n,
				branchIndex: p,
				netStyle: I,
				...V(e, "direction") ? { direction: s } : {},
				...V(e, "constraint") || g && V(f, "constraint") ? { constraint: P } : {},
				...re ? {
					scope: C.scope,
					boundaryScoped: C.boundaryScoped,
					insideSelfLoop: C.insideSelfLoop
				} : {},
				style: {
					...I,
					...M
				}
			};
		});
		if (u.size > 1 && H("Connection width mismatch", r + ".to"), u.size) for (let [e, n] of f.entries()) n.width = [...u][0], t.style.connection?.strokeWidth === void 0 && o.strokeWidth === void 0 && (n.netStyle.strokeWidth = ne(n.width).strokeWidth, a[e]?.style?.strokeWidth === void 0 && (n.style.strokeWidth = n.netStyle.strokeWidth));
		return f;
	}), A = V(e, "layout") ? e.layout : {};
	A && Object.hasOwn(A, "density") && H("Remove density; layout uses a single default configuration", "layout.density"), A && Object.hasOwn(A, "expandGroups") && H("Remove expandGroups; Container expansion is inferred from cells", "layout.expandGroups"), U(A, [
		"direction",
		"routing",
		"placement",
		"feedbackRouting",
		"feedbackSide",
		"feedbackMargin",
		"feedbackLaneSpacing",
		"moduleSpacing",
		"layerSpacing",
		"portAdjustment",
		"maxPortShift",
		"type",
		"cells",
		"rowGap",
		"columnGap",
		"blockMinWidth",
		"blockMinHeight",
		"blockAlign"
	], "layout");
	let N = (e, t) => V(A, e) ? A[e] : t, P = N("direction", "right"), F = N("routing", "orthogonal"), I = N("placement", "default"), L = p;
	["fixed", "reduce-bends"].includes(N("portAdjustment", "reduce-bends")) || H("Expected fixed or reduce-bends", "layout.portAdjustment");
	let R = N("maxPortShift", 40);
	(typeof R != "number" || !Number.isFinite(R) || R < 0) && H("Expected a finite non-negative shift", "layout.maxPortShift");
	let z = N("feedbackRouting", "elk"), B = N("feedbackSide", "auto");
	[
		"auto",
		"top",
		"bottom",
		"left",
		"right"
	].includes(B) || H("Expected auto, top, bottom, left or right feedback side", "layout.feedbackSide"), ["right", "down"].includes(P) || H("Unsupported layout direction", "layout.direction"), F !== "orthogonal" && H("Unsupported routing", "layout.routing"), [
		"default",
		"relaxed",
		"simple"
	].includes(I) || H("Unsupported placement strategy", "layout.placement"), ["elk", "outer"].includes(z) || H("Unsupported feedback routing", "layout.feedbackRouting"), z === "outer" && !["right", "down"].includes(P) && H("Outer feedback routing requires right or down direction", "layout.direction"), B !== "auto" && !(P === "down" ? ["left", "right"] : ["top", "bottom"]).includes(B) && H("Feedback side does not match flow direction", "layout.feedbackSide");
	let oe = new Set(c.flatMap((e) => e.members)), ce = se(A, [...i, ...c].filter((e) => !oe.has(e.id)).map((e) => e.id), "layout", H, !0, c);
	for (let [t, n] of c.entries()) V(e.groups[t], "layout") && (n.layout = se(e.groups[t].layout, n.members, `groups[${t}].layout`, H, !1, c));
	return {
		version: 1,
		diagram: t,
		modules: i,
		connections: k,
		groups: c,
		...m.length ? { terminals: m } : {},
		layout: {
			direction: P,
			routing: F,
			placement: I,
			feedbackRouting: z,
			feedbackSide: B,
			...ce.type === "grid" ? ce : V(A, "type") ? { type: "auto" } : {},
			feedbackMargin: q(N("feedbackMargin", 20), "layout.feedbackMargin"),
			feedbackLaneSpacing: q(N("feedbackLaneSpacing", 12), "layout.feedbackLaneSpacing"),
			moduleSpacing: q(N("moduleSpacing", L.moduleSpacing), "layout.moduleSpacing"),
			layerSpacing: q(N("layerSpacing", L.layerSpacing), "layout.layerSpacing"),
			...V(A, "portAdjustment") ? { portAdjustment: A.portAdjustment } : {},
			...V(A, "maxPortShift") ? { maxPortShift: R } : {}
		}
	};
}
// src/lib/blockchart/edit-diff.js
var J = (e) => typeof e == "object" && !!e && !Array.isArray(e);
function pe(e, t) {
	if (e === t) return !0;
	if (Array.isArray(e)) return Array.isArray(t) && e.length === t.length && e.every((e, n) => pe(e, t[n]));
	if (!J(e) || !J(t)) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && pe(e[n], t[n]));
}
function me(e, t) {
	let n = [];
	function r(e, t, i, a) {
		if (e !== t) {
			if (Array.isArray(e) && Array.isArray(t)) {
				if (e.length === t.length) {
					e.forEach((e, n) => r(e, t[n], i + "/" + n, a));
					return;
				}
				let o = 0, s = e.length, c = t.length;
				for (; o < s && o < c && pe(e[o], t[o]);) o++;
				for (; s > o && c > o && pe(e[s - 1], t[c - 1]);) s--, c--;
				n.push({
					...a,
					path: i,
					index: o,
					removed: e.slice(o, s),
					added: t.slice(o, c)
				});
			} else if (J(e) && J(t)) {
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
// src/lib/blockchart/edit-semantic-diff.js
var Y = (e = []) => e.map((e) => ({
	key: e.id,
	selector: { id: e.id },
	value: e
})), X = (e, t) => Object.fromEntries(Object.entries(e).filter(([e]) => !t.includes(e)));
function Z(e, t, n, r, i) {
	let a = new Map(e.map((e) => [e.key, e])), o = new Map(t.map((e) => [e.key, e]));
	for (let t of e) o.has(t.key) || r.push({
		...n,
		...t.selector,
		change: "removed",
		before: t.value
	});
	for (let e of t) {
		let t = a.get(e.key), o = {
			...n,
			...e.selector
		};
		t ? i(t.value, e.value, o) : r.push({
			...o,
			change: "added",
			after: e.value
		});
	}
	let s = e.filter((e) => o.has(e.key)), c = t.filter((e) => a.has(e.key));
	s.some((e, t) => e.key !== c[t].key) && r.push({
		...n,
		change: "order",
		before: s.map((e) => e.selector),
		after: c.map((e) => e.selector)
	});
}
function he(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.connections ?? []) {
		let e = h(n.from);
		t.has(e) || t.set(e, []), t.get(e).push(n);
	}
	return t;
}
function ge(e, t) {
	let n = new Set(e.to.map((e) => h(_(e))));
	return t.filter((e) => !e.id).map((e) => ({
		other: e,
		common: e.to.map((e) => h(_(e))).filter((e) => n.has(e))
	})).filter((e) => e.common.length);
}
function _e(e, t, n) {
	let r;
	return (e.connections ?? []).map((i) => {
		if (i.id) return {
			key: "id:" + i.id,
			selector: { id: i.id },
			value: i
		};
		let { from: a } = i, o = h(a), s = t.get(o), c = n.get(o) ?? [];
		if (s.length > 1 || c.length > 1) {
			let t = _(i.to[0]), n = {
				from: a,
				to: t
			}, l = ge(i, c);
			if (l.length === 1 && ge(l[0].other, s).length === 1) {
				let e = l[0].common.sort()[0];
				return {
					key: "pair:" + JSON.stringify([o, e]),
					selector: n,
					value: i
				};
			}
			r ??= C(e);
			let u = r.resolve(a, t, i.direction);
			if (u.source) return {
				key: "face:" + x(u.source),
				selector: n,
				value: i
			};
		}
		return {
			key: "source:" + o,
			selector: { from: a },
			value: i
		};
	});
}
function ve(e) {
	return e.to.map((t) => {
		let n = _(t);
		return {
			key: JSON.stringify([h(e.from), h(n)]),
			selector: {
				from: e.from,
				to: n
			},
			value: t
		};
	});
}
function ye(e, t) {
	let n = [];
	function r(e, t, r) {
		let i = me(e, t);
		i.length && n.push({
			...r,
			change: "updated",
			fields: i
		});
	}
	function i(e = [], t = [], r) {
		for (let i = 0; i < Math.max(e.length, t.length); i++) {
			let a = e[i] ?? [], o = t[i] ?? [];
			for (let e = 0; e < Math.max(a.length, o.length); e++) a[e] !== o[e] && n.push({
				kind: "gridCell",
				groupId: r,
				row: i,
				column: e,
				...e < a.length && { before: a[e] },
				...e < o.length && { after: o[e] }
			});
		}
	}
	function a(e, t) {
		let n = X(e, t);
		return n.layout &&= X(n.layout, ["cells"]), n;
	}
	function o(e, t, o) {
		let s = o.kind === "group", c = s ? ["ports", "members"] : ["ports"], l = a(e, c), u = a(t, c);
		if (!e.ports?.length && !t.ports?.length && (e.ports && (l.ports = e.ports), t.ports && (u.ports = t.ports)), r(l, u, o), Z(Y(e.ports), Y(t.ports), {
			kind: "port",
			owner: o.id
		}, n, r), s) {
			let r = new Set(e.members), a = new Set(t.members), s = e.members.filter((e) => !a.has(e)), c = t.members.filter((e) => !r.has(e));
			(s.length || c.length) && n.push({
				kind: "members",
				groupId: o.id,
				removed: s,
				added: c
			});
			let l = e.members.filter((e) => a.has(e)), u = t.members.filter((e) => r.has(e));
			l.some((e, t) => e !== u[t]) && n.push({
				kind: "members",
				groupId: o.id,
				change: "order",
				before: l,
				after: u
			}), i(e.layout?.cells, t.layout?.cells, o.id);
		}
	}
	Z(Y(e.modules), Y(t.modules), { kind: "module" }, n, o), Z(Y(e.groups), Y(t.groups), { kind: "group" }, n, o);
	let s = he(e), c = he(t);
	Z(_e(e, s, c), _e(t, c, s), { kind: "net" }, n, (e, t, i) => {
		r(X(e, ["to"]), X(t, ["to"]), i);
		let { kind: a, ...o } = i;
		Z(ve(e), ve(t), {
			kind: "branch",
			net: o
		}, n, (e, t, r) => {
			let i = Object.hasOwn(e, "endpoint"), a = Object.hasOwn(t, "endpoint"), o = me(i ? X(e, ["endpoint"]) : {}, a ? X(t, ["endpoint"]) : {});
			o.length ? n.push({
				...r,
				change: "updated",
				fields: o
			}) : i !== a && n.push({
				...r,
				change: "representation",
				before: e,
				after: t
			});
		});
	});
	let l = [
		"modules",
		"groups",
		"connections"
	];
	return r(a(e, l), a(t, l), { kind: "diagram" }), i(e.layout?.cells, t.layout?.cells, null), structuredClone(n);
}
// src/lib/blockchart/edit-rename.js
function be(e, t) {
	let n = new Map([...t.keys()].map((e) => [e, []]));
	function r(e, r, i = !1) {
		let a = i ? typeof e == "string" ? e.split(".")[0] : e?.moduleId : e;
		if (!t.has(a)) return e;
		let o = i ? typeof e == "string" ? t.get(a) + e.slice(a.length) : {
			...e,
			moduleId: t.get(a)
		} : t.get(a);
		return n.get(a).push({
			path: r,
			before: e,
			after: o
		}), o;
	}
	for (let n of e.modules) n.id = t.get(n.id) ?? n.id;
	function i(e, t) {
		e.layout?.cells?.forEach((e, n) => {
			e.forEach((i, a) => {
				e[a] = r(i, `${t}/layout/cells/${n}/${a}`);
			});
		});
	}
	return i(e, ""), e.groups?.forEach((e, t) => {
		e.members = e.members.map((e, n) => r(e, `/groups/${t}/members/${n}`)), i(e, `/groups/${t}`);
	}), e.connections?.forEach((e, t) => {
		e.from = r(e.from, `/connections/${t}/from`, !0), e.to = e.to.map((e, n) => {
			let i = `/connections/${t}/to/${n}`;
			return Object.hasOwn(e, "endpoint") ? {
				...e,
				endpoint: r(e.endpoint, i + "/endpoint", !0)
			} : r(e, i, !0);
		});
	}), n;
}
// src/lib/blockchart/edit.js
var xe = (e) => typeof e == "object" && !!e && !Array.isArray(e), Se = (e) => typeof e == "string" ? e.split(".")[0] : e.terminal;
function Q(e, t) {
	if (!xe(e)) throw Error("Expected an object");
	for (let n of Object.keys(e)) if (!t.includes(n)) throw Error("Unexpected field: " + n);
}
function $(e, t, n) {
	let r = e?.find((e) => e.id === t);
	if (!r) throw Error("Unknown " + n + " ID: " + String(t));
	return r;
}
function Ce(e, t) {
	Q(t, [
		"moduleId",
		"groupId",
		"recursive"
	]);
	let n = Object.hasOwn(t, "groupId");
	if (n === Object.hasOwn(t, "moduleId")) throw Error("Specify exactly one groupId or moduleId");
	if (Object.hasOwn(t, "recursive") && (typeof t.recursive != "boolean" || !n)) throw Error("recursive requires a group query and a boolean");
	de(e);
	let r = e.groups ?? [], i = n ? $(r, t.groupId, "group") : $(e.modules, t.moduleId, "module"), a = /* @__PURE__ */ new Set([i.id]);
	if (n) for (let n of t.recursive ? b(e, i.id) : i.members) a.add(n);
	let o = /* @__PURE__ */ new Map();
	function s(t) {
		return o.has(t) || o.set(t, y(e, t)), o.get(t);
	}
	let c = new Set(r.filter((e) => e.type === "boundary").map((e) => e.id)), l = [];
	for (let { from: t, to: n, ...r } of e.connections ?? []) for (let e of n) {
		let n = _(e), i = Se(t), o = Se(n), u = a.has(i), d = a.has(o);
		if (!u && !d) continue;
		let f = c.has(i) ? [...s(i), i] : s(i), p = c.has(o) ? [...s(o), o] : s(o), { endpoint: m, ...h } = Object.hasOwn(e, "endpoint") ? e : {};
		l.push({
			from: t,
			to: n,
			fromPath: f,
			toPath: p,
			relation: u && d ? "internal" : u ? "outgoing" : "incoming",
			crossGroup: f.length !== p.length || f.some((e, t) => e !== p[t]),
			net: r,
			branch: h
		});
	}
	return structuredClone({
		id: i.id,
		path: s(i.id),
		modules: e.modules.filter((e) => a.has(e.id)),
		groups: r.filter((e) => e.id === i.id || t.recursive && a.has(e.id)),
		branches: l
	});
}
function we(e, t) {
	return !xe(e) || !xe(t) ? t : {
		...e,
		...Object.fromEntries(Object.entries(t).map(([t, n]) => [t, we(Object.hasOwn(e, t) ? e[t] : void 0, n)]))
	};
}
function Te(e, t, n) {
	Q(t, n);
	for (let [n, r] of Object.entries(t)) e[n] = n === "style" ? we(e.style, r) : r;
}
function Ee(e) {
	if (typeof e == "string" && /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(e) || xe(e) && Object.keys(e).length === 1 && typeof e.terminal == "string" && /^[A-Za-z_]\w*$/.test(e.terminal)) return e;
	throw Error("Invalid endpoint: " + JSON.stringify(e));
}
var De = [
	"style",
	"feedback",
	"constraint"
];
function Oe(e, t) {
	let n = h(Ee(t));
	return (e.connections ?? []).filter((e) => h(e.from) === n);
}
function ke(e, t) {
	let n = h(t);
	return e.to.findIndex((e) => h(_(e)) === n);
}
function Ae(e, t) {
	Q(t, [
		"op",
		"id",
		"from",
		"to",
		"patch"
	]);
	let n;
	if (Object.hasOwn(t, "id")) {
		if (typeof t.id != "string" || Object.hasOwn(t, "from") || Object.hasOwn(t, "to")) throw Error("Select a Net by its authored ID or by endpoints");
		n = $(e.connections, t.id, "Net");
	} else {
		let r = Oe(e, t.from);
		if (Object.hasOwn(t, "to")) {
			let e = Ee(t.to);
			r = r.filter((t) => ke(t, e) >= 0);
		}
		if (!r.length) throw Error("Net not found");
		if (r.length > 1) throw Error("Ambiguous source: specify a destination or a Net ID");
		[n] = r;
	}
	Te(n, t.patch, ["label", "style"]);
}
function je(e, t) {
	let n = t.op === "addBranch", r = t.op === "updateBranch";
	Q(t, [
		"op",
		"from",
		"to",
		...n ? ["branch", "net"] : r ? ["patch"] : []
	]);
	let i = t.from, a = Ee(t.to), o = Oe(e, i);
	for (let i of o) {
		let o = ke(i, a);
		if (!(o < 0)) {
			if (n) throw Error("Branch already exists");
			if (r) {
				let e = i.to[o], n = Object.hasOwn(e, "endpoint") ? e : { endpoint: e };
				Te(n, t.patch, De), Object.keys(t.patch).length && (i.to[o] = n);
				return;
			}
			i.to.splice(o, 1), i.to.length || e.connections.splice(e.connections.indexOf(i), 1);
			return;
		}
	}
	if (!n) throw Error("Branch not found");
	Object.hasOwn(t, "branch") && Q(t.branch, De), Object.hasOwn(t, "net") && Q(t.net, [
		"id",
		"label",
		"style",
		"feedback",
		"constraint",
		"direction"
	]);
	let s = C(e);
	function c(e, t) {
		let n = s.resolve(i, e, t);
		if (n.error) throw Error(n.error);
		return x(n.source);
	}
	let l = c(a, t.net?.direction), u = o.find((e) => c(_(e.to[0]), e.direction) === l), d = t.branch ? {
		endpoint: a,
		...t.branch
	} : a;
	if (u) {
		if (t.net) throw Error("net fields apply only when creating a Net");
		u.to.push(d);
	} else (e.connections ??= []).push({
		...t.net,
		from: i,
		to: [d]
	});
}
var Me = [
	"label",
	"ports",
	"style",
	"width",
	"height",
	"appearance",
	"type"
];
function Ne(e, t) {
	switch (t?.op) {
		case "renameModule":
			if (Q(t, [
				"op",
				"id",
				"newId"
			]), $(e.modules, t.id, "module"), typeof t.newId != "string" || !/^[A-Za-z_]\w*$/.test(t.newId)) throw Error("Invalid new module ID: " + String(t.newId));
			if ([...e.modules, ...e.groups ?? []].some((e) => e.id === t.newId)) throw Error("ID already exists: " + t.newId);
			be(e, /* @__PURE__ */ new Map([[t.id, t.newId]]));
			break;
		case "addModule":
			if (Q(t, ["op", "module"]), Q(t.module, ["id", ...Me]), !t.module.id) throw Error("Expected a module ID");
			if ([
				...e.modules,
				...e.groups ?? [],
				...e.terminals ?? []
			].some((e) => e.id === t.module.id)) throw Error("ID already exists: " + t.module.id);
			e.modules.push(t.module);
			break;
		case "updateModule":
			Q(t, [
				"op",
				"id",
				"patch"
			]), Te($(e.modules, t.id, "module"), t.patch, Me);
			break;
		case "removeModule": {
			Q(t, ["op", "id"]);
			let n = $(e.modules, t.id, "module");
			e.modules.splice(e.modules.indexOf(n), 1);
			for (let n of e.groups ?? []) n.members = n.members.filter((e) => e !== t.id);
			ce(e, t.id, null), e.connections && v(e, (e) => Se(e) === t.id);
			break;
		}
		case "setGroupMembers": {
			Q(t, [
				"op",
				"id",
				"members"
			]);
			let n = $(e.groups, t.id, "group");
			if (!Array.isArray(t.members)) throw Error("Expected members array");
			let r = new Set([...e.modules, ...e.groups].map((e) => e.id));
			for (let e of t.members) if (!r.has(e)) throw Error("Unknown member ID: " + e);
			n.members = t.members;
			break;
		}
		case "setGridCells": {
			Q(t, [
				"op",
				"id",
				"cells"
			]);
			let n = $(e.groups, t.id, "group");
			if (!Array.isArray(t.cells)) throw Error("Expected a cells matrix");
			n.layout = {
				...n.layout,
				type: "grid",
				cells: t.cells
			};
			break;
		}
		case "updateNet":
			Ae(e, t);
			break;
		case "addBranch":
		case "updateBranch":
		case "removeBranch":
			je(e, t);
			break;
		default: throw Error("Unknown operation: " + String(t?.op));
	}
}
function Pe(e, t) {
	let n = e?.from !== void 0 || e?.to !== void 0 ? h(e.from) + (e.to === void 0 ? "" : " -> " + h(e.to)) : e?.id ?? e?.module?.id ?? "";
	return `ops[${t}] ${e?.op ?? "?"} ${n}`.trimEnd();
}
function Fe(e, t, n = {}) {
	Q(n, ["diffFormat"]);
	let { diffFormat: r = "pointer" } = n;
	if (!["pointer", "semantic"].includes(r)) throw Error("diffFormat must be pointer or semantic");
	if (!Array.isArray(t)) throw Error("Expected an array of operations");
	let i = structuredClone(e), a = i.modules.map((e) => ({
		module: e,
		id: e.id
	}));
	for (let [e, n] of t.entries()) try {
		Ne(i, structuredClone(n));
	} catch (t) {
		throw Error(Pe(n, e) + ": " + t.message, { cause: t });
	}
	!Object.hasOwn(e, "connections") && i.connections?.length === 0 && delete i.connections;
	try {
		de(i);
	} catch (e) {
		let n = t.map(Pe).join(", ");
		throw Error(`Validation at ${e.path || "/"}: ${e.message}${n ? " after " + n : ""}`, { cause: e });
	}
	if (r === "pointer") return {
		document: i,
		diff: me(e, i)
	};
	let o = new Map(a.filter(({ module: e, id: t }) => i.modules.includes(e) && e.id !== t).map(({ module: e, id: t }) => [t, e.id])), s = structuredClone(e), c = be(s, o);
	return {
		document: i,
		diff: [...[...o].map(([e, t]) => ({
			kind: "module",
			change: "rename",
			id: e,
			newId: t,
			references: c.get(e)
		})), ...ye(s, i)]
	};
}
// src/agent-kit/blockchart-edit.js
var Ie = "blockchart-agent-kit-23be7e737990fd0d41d1", Le = "Usage:\n  node blockchart-edit.mjs inspect diagram.json --module ID\n  node blockchart-edit.mjs inspect diagram.json --group ID [--recursive]\n  node blockchart-edit.mjs apply diagram.json --ops changes.json [--diff-format pointer|semantic] [--write]\n  node blockchart-edit.mjs --help | --version\napply prints a JSON diff. Only --write replaces the diagram. Use --ops - to read operations from stdin.";
async function Re(e) {
	if (e.length === 1 && [
		"--help",
		"-h",
		"--version"
	].includes(e[0])) {
		console.log(e[0] === "--version" ? Ie : Le);
		return;
	}
	let [r, ...i] = e;
	if (!["inspect", "apply"].includes(r)) throw Error(Le);
	let { values: a, positionals: o } = l({
		args: i,
		allowPositionals: !0,
		options: r === "inspect" ? {
			module: { type: "string" },
			group: { type: "string" },
			recursive: { type: "boolean" }
		} : {
			ops: { type: "string" },
			write: { type: "boolean" },
			"diff-format": { type: "string" }
		}
	});
	if (o.length !== 1) throw Error("Expected a single diagram filename");
	let s = await n(o[0]), c = await t(s, "utf8"), d = u(c, s), p;
	if (r === "inspect") p = Ce(d, {
		...a.module !== void 0 && { moduleId: a.module },
		...a.group !== void 0 && { groupId: a.group },
		...a.recursive && { recursive: !0 }
	});
	else {
		if (!a.ops) throw Error("apply requires --ops FILE or --ops -");
		let e = "";
		if (a.ops === "-") {
			process.stdin.setEncoding("utf8");
			for await (let t of process.stdin) e += t;
		} else e = await t(a.ops, "utf8");
		let n = Fe(d, u(e, a.ops), { diffFormat: a["diff-format"] });
		a.write && n.diff.length && await f(s, c, n.document), p = n.diff;
	}
	console.log(JSON.stringify(p, null, 2));
}
if (process.argv[1] && c(s(process.argv[1])).href === import.meta.url) try {
	await Re(process.argv.slice(2));
} catch (e) {
	console.error(e.path ? e.path + ": " + e.message : e.message), process.exitCode = 1;
}
export { Ie as KIT_VERSION, Fe as applyDiagramOps, Ce as inspectDiagram };
