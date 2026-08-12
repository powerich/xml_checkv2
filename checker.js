// ============================================================
// 核心检查逻辑模块：供桌面应用界面调用
// 扫描指定文件夹下所有 XML 文件，或检查单个 XML 文件，
// 检查公英制单位换算、制式一致性、符号规范，生成两份汇总报表
// ============================================================

const fs = require("fs");
const path = require("path");
const { DOMParser } = require("@xmldom/xmldom");

// ---------- 单位定义 ----------
const UNIT_DEFS = {
  "m": { std: "m", category: "length", system: "metric", toBase: 1 },
  "km": { std: "km", category: "length", system: "metric", toBase: 1000 },
  "cm": { std: "cm", category: "length", system: "metric", toBase: 0.01 },
  "mm": { std: "mm", category: "length", system: "metric", toBase: 0.001 },
  "ft": { std: "ft", category: "length", system: "imperial", toBase: 0.3048 },
  "nm": { std: "NM", category: "length", system: "imperial", toBase: 1852 },
  "mi": { std: "mi", category: "length", system: "imperial", toBase: 1609.34 },
  "yd": { std: "yd", category: "length", system: "imperial", toBase: 0.9144 },
  "in": { std: "in", category: "length", system: "imperial", toBase: 0.0254 },
  "kg": { std: "kg", category: "mass", system: "metric", toBase: 1 },
  "g": { std: "g", category: "mass", system: "metric", toBase: 0.001 },
  "t": { std: "t", category: "mass", system: "metric", toBase: 1000 },
  "lb": { std: "lb", category: "mass", system: "imperial", toBase: 0.453592 },
  "lbs": { std: "lb", category: "mass", system: "imperial", toBase: 0.453592 },
  "kt": { std: "kt", category: "speed", system: "imperial", toBase: 1.852 },
  "kts": { std: "kt", category: "speed", system: "imperial", toBase: 1.852 },
  "km/h": { std: "km/h", category: "speed", system: "metric", toBase: 1 },
  "kmh": { std: "km/h", category: "speed", system: "metric", toBase: 1 },
  "mph": { std: "mph", category: "speed", system: "imperial", toBase: 1.60934 },
  "m/s": { std: "m/s", category: "speed", system: "metric", toBase: 3.6 },
  "hpa": { std: "hPa", category: "pressure", system: "metric", toBase: 1 },
  "kpa": { std: "kPa", category: "pressure", system: "metric", toBase: 10 },
  "psi": { std: "psi", category: "pressure", system: "imperial", toBase: 68.9476 },
  "inhg": { std: "inHg", category: "pressure", system: "imperial", toBase: 33.8639 },
  "mmhg": { std: "mmHg", category: "pressure", system: "metric", toBase: 1.33322 },
  "m2": { std: "m²", category: "area", system: "metric", toBase: 1 },
  "m²": { std: "m²", category: "area", system: "metric", toBase: 1 },
  "ft2": { std: "ft²", category: "area", system: "imperial", toBase: 0.092903 },
  "ft²": { std: "ft²", category: "area", system: "imperial", toBase: 0.092903 },
  "l": { std: "L", category: "volume", system: "metric", toBase: 1 },
  "gal": { std: "gal", category: "volume", system: "imperial", toBase: 3.78541 },
  "usgal": { std: "US gal", category: "volume", system: "imperial", toBase: 3.78541 },
  "n": { std: "N", category: "force", system: "metric", toBase: 1 },
  "lbf": { std: "lbf", category: "force", system: "imperial", toBase: 4.44822 },
  "hz": { std: "Hz", category: "frequency", system: "metric", toBase: 1 },
  "mhz": { std: "MHz", category: "frequency", system: "metric", toBase: 1000000 }
};

const CATEGORY_NAME = {
  length: "长度", mass: "质量", speed: "速度", pressure: "压力",
  area: "面积", volume: "体积", force: "力", frequency: "频率",
  temp: "温度", torque: "扭矩"
};

const WARN_THRESHOLD_PCT = 3;

const PSI_KPA_REFERENCE = [
  { psi: 14.7, note: "标准大气压附近" },
  { psi: 32, note: "常见汽车轮胎压力量级" },
  { psi: 200, note: "常见航空器轮胎压力量级" },
  { psi: 250, note: "常见航空器轮胎压力量级" }
];

function checkPsiKpaReference(psiVal) {
  for (const ref of PSI_KPA_REFERENCE) {
    if (Math.abs(psiVal - ref.psi) / ref.psi < 0.05) return "（参考：约为" + ref.note + "）";
  }
  return "";
}

function normalizeUnitKey(u) { return u.replace(/\s+/g, "").toLowerCase(); }
function cToF(c) { return c * 9 / 5 + 32; }
function fToC(f) { return (f - 32) * 5 / 9; }

function parseNum(s) {
  s = s.trim();
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
  return parseFloat(s.replace(/,/g, ""));
}

const unitKeys = [Object.keys(UNIT_DEFS), ["°C", "°F", "N·m", "N.m"]]
  .reduce(function (a, b) { return a.concat(b); }, [])
  .sort(function (a, b) { return b.length - a.length; })
  .map(function (u) { return u.replace(/\//g, "\\/").replace(/\./g, "\\."); });
const unitAlt = unitKeys.join("|");
const WSP = "(?:\\s|\\[\\[(?:PAGE|LINE):\\d+\\]\\])*";
const NUM = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|[\\d,]+\\.?\\d*)";
const OPEN_BR = "[\\(\uFF08]";
const CLOSE_BR = "[\\)\uFF09]";

const pairRegex = new RegExp(
  "(" + NUM + ")" + WSP + "(" + unitAlt + ")\\b" + WSP +
  OPEN_BR + WSP + "(" + NUM + ")" + WSP + "(" + unitAlt + ")" + WSP + CLOSE_BR,
  "gi"
);
const singleUnitRegex = new RegExp("(" + NUM + ")" + WSP + "(" + unitAlt + ")\\b", "gi");

function cleanMatchText(s) {
  return s.replace(/\[\[PAGE:\d+\]\]/g, " ").replace(/\s+/g, " ").trim();
}

function checkCase(rawUnit, category) {
  if (category === "temp") {
    if (rawUnit === "°C" || rawUnit === "°F") return { ok: true };
    return { ok: false, suggestion: rawUnit.toUpperCase().indexOf("C") >= 0 ? "°C" : "°F" };
  }
  const def = UNIT_DEFS[normalizeUnitKey(rawUnit)];
  if (!def) return { ok: true };
  if (rawUnit === def.std) return { ok: true };
  return { ok: false, suggestion: def.std };
}

function getSystem(u) {
  const un = normalizeUnitKey(u);
  if (un === "°c") return "metric";
  if (un === "°f") return "imperial";
  const def = UNIT_DEFS[un];
  return def ? def.system : null;
}

function getCategory(u) {
  const un = normalizeUnitKey(u);
  if (un === "°c" || un === "°f") return "temp";
  const def = UNIT_DEFS[un];
  return def ? def.category : null;
}

function buildPageMap(text) {
  const marks = [];
  const re = /\[\[PAGE:(\d+)\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) marks.push({ index: m.index, page: parseInt(m[1]) });
  return marks;
}

function findPage(pos, marks) {
  if (marks.length === 0) return null;
  let page = marks[0].page;
  for (const mk of marks) {
    if (mk.index <= pos) page = mk.page; else break;
  }
  return page;
}

// ---------- 核心检查逻辑 ----------
function runCheckOnText(text, opts) {
  const tolerancePct = opts.tolerancePct !== undefined ? opts.tolerancePct : 1;
  const caseStrict = opts.caseStrict !== undefined ? opts.caseStrict : true;
  const checkUnpaired = opts.checkUnpaired !== undefined ? opts.checkUnpaired : true;
  const preferredSystem = opts.preferredSystem !== undefined ? opts.preferredSystem : "metric";
  const pageMarks = buildPageMap(text);

  const pairedRows = [];
  const unpairedRows = [];
  let okCount = 0, warnCount = 0, errCount = 0, unpairedCount = 0;
  const systemStats = {};

  function recordSystem(category, system, entryText, page, role) {
    if (!category || !system) return;
    if (!systemStats[category]) systemStats[category] = { metric: [], imperial: [] };
    systemStats[category][system].push({ text: entryText, page: page, role: role });
  }

  let match;
  pairRegex.lastIndex = 0;
  const matchedSpans = [];

  while ((match = pairRegex.exec(text)) !== null) {
    matchedSpans.push([match.index, match.index + match[0].length]);
    const full = match[0], v1 = match[1], u1 = match[2], v2 = match[3], u2 = match[4];
    const val1 = parseNum(v1), val2 = parseNum(v2);
    const u1n = normalizeUnitKey(u1), u2n = normalizeUnitKey(u2);
    const page = findPage(match.index, pageMarks);
    const cleanFull = cleanMatchText(full);

    let status = "ok";
    let detail = "";
    let suggestion = "";

    const isTemp1 = (u1n === "°c");
    const isTempPair = (u1n === "°c" && u2n === "°f") || (u1n === "°f" && u2n === "°c");

    if (isTempPair) {
      const expected2 = isTemp1 ? cToF(val1) : fToC(val1);
      const absDiff = Math.abs(expected2 - val2);
      const denom = Math.max(Math.abs(expected2), Math.abs(val2), 1);
      const diffPct = absDiff / denom * 100;

      if (diffPct <= tolerancePct) {
        status = "ok";
        detail = "温度换算正确（误差 " + diffPct.toFixed(2) + "%）";
      } else if (diffPct < WARN_THRESHOLD_PCT) {
        status = "warn";
        suggestion = "按 " + v1 + u1 + " 换算，应约为 " + expected2.toFixed(1) + u2 +
          "，原文写的是 " + v2 + u2 + "（误差 " + diffPct.toFixed(1) + "%，误差较小，建议人工核实是否为四舍五入）";
      } else {
        status = "err";
        suggestion = "按 " + v1 + u1 + " 换算，应约为 " + expected2.toFixed(1) + u2 +
          "，原文写的是 " + v2 + u2 + "（误差 " + diffPct.toFixed(1) + "%）";
      }
    } else {
      const def1 = UNIT_DEFS[u1n] || (u1.indexOf("N") >= 0 ? { category: "torque", toBase: 1 } : null);
      const def2 = UNIT_DEFS[u2n] || (u2.indexOf("N") >= 0 ? { category: "torque", toBase: 1 } : null);

      if (!def1 || !def2) {
        status = "warn";
        detail = "无法识别的单位组合，请人工核对";
      } else if (def1.category !== def2.category) {
        status = "err";
        detail = "单位类别不匹配：" + u1 + "与" + u2;
      } else {
        const expectedVal2 = (val1 * def1.toBase) / def2.toBase;
        const diffPct = Math.abs(expectedVal2 - val2) / (expectedVal2 || 1) * 100;

        if (diffPct <= tolerancePct) {
          status = "ok";
          detail = "换算正确（误差 " + diffPct.toFixed(2) + "%）";
        } else if (diffPct < WARN_THRESHOLD_PCT) {
          status = "warn";
          suggestion = "按 " + v1 + " " + u1 + " 换算，应约为 " + expectedVal2.toFixed(2) + " " + u2 +
            "，原文写的是 " + v2 + " " + u2 + "（误差 " + diffPct.toFixed(1) + "%，误差较小，建议人工核实是否为四舍五入或有效数字差异）";
        } else {
          status = "err";
          suggestion = "按 " + v1 + " " + u1 + " 换算，应约为 " + expectedVal2.toFixed(2) + " " + u2 +
            "，原文写的是 " + v2 + " " + u2 + "（误差 " + diffPct.toFixed(1) + "%）";
        }

        if (u1n === "psi" || u2n === "psi") {
          const refNote = checkPsiKpaReference(u1n === "psi" ? val1 : val2);
          if (refNote) detail += " " + refNote;
        }
      }
    }

    let caseNote = "";
    if (caseStrict) {
      const c1 = checkCase(u1, getCategory(u1));
      const c2 = checkCase(u2, getCategory(u2));
      if (!c1.ok) {
        caseNote += "\"" + u1 + "\"建议写作\"" + c1.suggestion + "\"；";
        if (status === "ok") status = "warn";
      }
      if (!c2.ok) {
        caseNote += "\"" + u2 + "\"建议写作\"" + c2.suggestion + "\"；";
        if (status === "ok") status = "warn";
      }
    }

    const finalDetail = (detail || "") + (suggestion ? " " + suggestion : "") + (caseNote ? " " + caseNote : "");
    pairedRows.push({ text: cleanFull, status: status, detail: finalDetail, page: page });

    if (status === "ok") okCount++;
    else if (status === "warn") warnCount++;
    else errCount++;

    const cat1x = getCategory(u1), sys1 = getSystem(u1), sys2 = getSystem(u2);
    if (cat1x !== "temp") {
      if (cat1x && sys1) recordSystem(cat1x, sys1, cleanFull, page, "主单位");

      if (sys1 && sys2 && sys1 !== sys2 && sys1 !== preferredSystem) {
        const lastRow = pairedRows[pairedRows.length - 1];
        lastRow.detail += " ｜提示：主单位制式与预设不符";
        if (lastRow.status === "ok") {
          lastRow.status = "warn";
          warnCount++;
          okCount--;
        }
      }
    }
  }

  singleUnitRegex.lastIndex = 0;
  while ((match = singleUnitRegex.exec(text)) !== null) {
    const start = match.index, end = match.index + match[0].length;
    let inside = false;
    for (const span of matchedSpans) {
      if (start >= span[0] && end <= span[1]) { inside = true; break; }
    }
    if (inside) continue;

    const full = match[0], v = match[1], u = match[2];
    const un = normalizeUnitKey(u);
    const page = findPage(match.index, pageMarks);
    const category = getCategory(u);
    const system = getSystem(u);

    const noteParts = [];
    if (checkUnpaired) noteParts.push("⚠️ 未见公英制换算对照");
    if (caseStrict) {
      const c = checkCase(u, category);
      if (!c.ok) noteParts.push("建议写作 \"" + c.suggestion + "\"");
    }
    if (un === "psi") {
      const r = checkPsiKpaReference(parseNum(v));
      if (r) noteParts.push(r);
    }

    unpairedRows.push({
      text: cleanMatchText(full),
      category: category ? (CATEGORY_NAME[category] || category) : "未知",
      detail: noteParts.join("；") || "格式正常",
      page: page
    });
    unpairedCount++;

    if (category && system && category !== "temp") {
      recordSystem(category, system, cleanMatchText(full), page, "单独出现");
    }
  }

  const consistencyIssues = [];
  for (const cat in systemStats) {
    if (systemStats[cat].metric.length > 0 && systemStats[cat].imperial.length > 0) {
      consistencyIssues.push(CATEGORY_NAME[cat] || cat);
    }
  }

  return {
    pairedRows: pairedRows,
    unpairedRows: unpairedRows,
    okCount: okCount,
    warnCount: warnCount,
    errCount: errCount,
    unpairedCount: unpairedCount,
    consistencyIssues: consistencyIssues
  };
}

// ---------- XML 文本提取 ----------
function extractTextFromXml(xmlString) {
  let fullText = "";
  let counter = 0;
  try {
    const parser = new DOMParser({
      errorHandler: {
        warning: function () {},
        error: function () {},
        fatalError: function (e) { throw new Error(e); }
      }
    });
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const root = xmlDoc.documentElement;
    if (!root) throw new Error("无根节点");

    function walk(node) {
      if (node.nodeType === 1) {
        let directText = "";
        const children = Array.prototype.slice.call(node.childNodes || []);
        for (const child of children) {
          if (child.nodeType === 3) directText += child.nodeValue;
        }
        directText = directText.trim();
        if (directText.length > 0) {
          counter++;
          fullText += "[[PAGE:" + counter + "]]\n" + directText + "\n";
        }
        for (const child of children) walk(child);
      }
    }
    walk(root);
  } catch (e) {
    const stripped = xmlString.replace(/<[^>]+>/g, "\n");
    fullText = "[[PAGE:1]]\n" + stripped;
    counter = 1;
    return { text: fullText, counter: counter, parseFailed: true };
  }
  return { text: fullText, counter: counter, parseFailed: false };
}

// ---------- CSV 输出工具 ----------
function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val).replace(/"/g, '""');
  return '"' + s + '"';
}

function writeCsv(filePath, headers, rows) {
  const BOM = "\uFEFF";
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  fs.writeFileSync(filePath, BOM + lines.join("\n"), "utf8");
}

// ---------- 递归遍历文件夹 ----------
function findAllXmlFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(findAllXmlFiles(fullPath));
    } else if (item.isFile() && item.name.toLowerCase().endsWith(".xml")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ---------- 判断目标路径是文件夹还是单个文件 ----------
// 返回统一结构，供 runBatchCheck 使用，上层调用方无需关心具体类型
function resolveTargetFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error("路径不存在：" + targetPath);
  }
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    if (!targetPath.toLowerCase().endsWith(".xml")) {
      throw new Error("所选文件不是 .xml 文件：" + targetPath);
    }
    return {
      isSingleFile: true,
      files: [targetPath],
      baseDir: path.dirname(targetPath),
      outDir: path.dirname(targetPath)
    };
  } else if (stat.isDirectory()) {
    return {
      isSingleFile: false,
      files: findAllXmlFiles(targetPath),
      baseDir: targetPath,
      outDir: targetPath
    };
  } else {
    throw new Error("所选路径既不是文件也不是文件夹：" + targetPath);
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ---------- 单文件检查（供批量检查内部调用，也可单独导出使用） ----------
function checkOneFile(filePath, baseDir) {
  const fileName = path.relative(baseDir, filePath) || path.basename(filePath);
  const xmlString = fs.readFileSync(filePath, "utf8");
  const extracted = extractTextFromXml(xmlString);
  const result = runCheckOnText(extracted.text, {
    tolerancePct: 1,
    caseStrict: true,
    checkUnpaired: true,
    preferredSystem: "metric"
  });
  return { fileName: fileName, extracted: extracted, result: result };
}

// ---------- 主入口：供 Electron 界面调用 ----------
// targetPath: 用户选择的文件夹路径 或 单个 XML 文件路径（自动判断）
// onProgress: 回调函数 (current, total) => {}，用于实时更新界面进度条
async function runBatchCheck(targetPath, onProgress) {
  const { isSingleFile, files: xmlFiles, baseDir, outDir } = resolveTargetFiles(targetPath);
  const total = xmlFiles.length;

  const summaryRows = [];
  const issueRows = [];
  const failedFiles = [];
  const startTime = Date.now();

  for (let idx = 0; idx < xmlFiles.length; idx++) {
    const filePath = xmlFiles[idx];
    const fileName = path.relative(baseDir, filePath) || path.basename(filePath);
    try {
      const xmlString = fs.readFileSync(filePath, "utf8");
      const extracted = extractTextFromXml(xmlString);
      if (extracted.parseFailed) failedFiles.push(fileName);

      const result = runCheckOnText(extracted.text, {
        tolerancePct: 1,
        caseStrict: true,
        checkUnpaired: true,
        preferredSystem: "metric"
      });

      summaryRows.push([
        fileName,
        result.okCount,
        result.warnCount,
        result.errCount,
        result.unpairedCount,
        result.consistencyIssues.join("；") || "无"
      ]);

      for (const r of result.pairedRows) {
        if (r.status === "err" || r.status === "warn") {
          issueRows.push([
            fileName,
            "第" + r.page + "节点",
            r.text,
            r.status === "err" ? "❌错误" : "⚠️建议",
            r.detail
          ]);
        }
      }
    } catch (e) {
      failedFiles.push(fileName + " —— 错误信息：" + e.message);
      summaryRows.push([fileName, "-", "-", "-", "-", "解析失败"]);
    }

    if (onProgress && ((idx + 1) % 10 === 0 || idx === xmlFiles.length - 1)) {
      onProgress(idx + 1, total);
    }
    // 每处理20个文件，让出一次事件循环，避免长时间阻塞导致界面消息队列堆积
    if ((idx + 1) % 20 === 0) await sleep(0);
  }

  // 单文件模式下，输出文件名带上该文件名作为前缀，避免和批量结果混淆
  const prefix = isSingleFile
    ? "_" + path.basename(targetPath, path.extname(targetPath)) + "_检查结果"
    : "_检查结果";

  const summaryPath = path.join(outDir, prefix + "_汇总.csv");
  const issuePath = path.join(outDir, prefix + "_问题清单.csv");
  const failedPath = path.join(outDir, prefix + "_解析失败列表.txt");

  writeCsv(summaryPath, ["文件名", "正确数", "建议数", "错误数", "未配对数", "制式混用类别"], summaryRows);
  writeCsv(issuePath, ["文件名", "位置", "原文片段", "状态", "说明"], issueRows);
  if (failedFiles.length > 0) {
    fs.writeFileSync(failedPath, failedFiles.join("\n"), "utf8");
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // 计算总体统计，用于界面展示
  let totalOk = 0, totalWarn = 0, totalErr = 0, totalUnpaired = 0;
  for (const row of summaryRows) {
    if (typeof row[1] === "number") totalOk += row[1];
    if (typeof row[2] === "number") totalWarn += row[2];
    if (typeof row[3] === "number") totalErr += row[3];
    if (typeof row[4] === "number") totalUnpaired += row[4];
  }

  return {
    isSingleFile: isSingleFile,
    totalFiles: total,
    totalOk: totalOk,
    totalWarn: totalWarn,
    totalErr: totalErr,
    totalUnpaired: totalUnpaired,
    failedCount: failedFiles.length,
    elapsedSeconds: totalTime,
    summaryPath: summaryPath,
    issuePath: issuePath,
    failedPath: failedFiles.length > 0 ? failedPath : null,
    targetFolder: outDir   // 保留原字段名，避免调用方（界面代码）需要跟着改
  };
}

module.exports = { runBatchCheck, checkOneFile, resolveTargetFiles, findAllXmlFiles };