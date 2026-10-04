// Original st-chatu8 v3.1.2 parser excerpts, AFPL. Test fixtures only; never loaded by the plugin.
function getBaseTag(tag) {
  let base = tag.toLowerCase();
  let prev;
  do {
    prev = base;
    base = base.replace(/^[([{<]+/, "");
    base = base.replace(/[)\]}>]+$/, "");
    base = base.replace(/^[\d.]+::/, "");
    base = base.replace(/::$/, "");
    base = base.replace(/:(?:\d*\.\d+|\d+)$/, "");
    base = base.trim();
  } while (base !== prev);
  return base;
}

function hasWeight(tag) {
  return tag.toLowerCase() !== getBaseTag(tag);
}

function deduplicateTags(tagString) {
  if (!tagString || typeof tagString !== "string") {
    return "";
  }
  const placeholders = [];
  let tempString = tagString.replace(/\$([^$]+)\$/g, (match) => {
    placeholders.push(match);
    return `__ST_JSON_TAG_${placeholders.length - 1}__`;
  });
  const tags = tempString.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (tags.length === 0) {
    return "";
  }
  const uniqueTags = /* @__PURE__ */ new Map();
  for (let tag of tags) {
    tag = tag.replace(/__ST_JSON_TAG_(\d+)__/g, (m, idx) => placeholders[parseInt(idx)]);
    const baseTag = getBaseTag(tag);
    if (!uniqueTags.has(baseTag)) {
      uniqueTags.set(baseTag, tag);
    } else {
      const existingTag = uniqueTags.get(baseTag);
      const isNewWeighted = hasWeight(tag);
      const isExistingWeighted = hasWeight(existingTag);
      if (!isExistingWeighted && isNewWeighted) {
        uniqueTags.set(baseTag, tag);
      }
    }
  }
  const result = Array.from(uniqueTags.values()).join(", ");
  if (tags.length !== uniqueTags.size) {
    addLog(`[\u53BB\u91CD] ${tags.length} \u4E2A\u6807\u7B7E \u2192 ${uniqueTags.size} \u4E2A\u6807\u7B7E (\u79FB\u9664 ${tags.length - uniqueTags.size} \u4E2A\u91CD\u590D)`);
  }
  return result;
}

function parsePromptStringWithCoordinates(promptString) {
  addLog(`\u89E3\u6790\u573A\u666F\u6784\u56FE\u5B57\u7B26\u4E32: ${promptString}`);
  const result = {
    "Scene Composition": "",
    "Character 1 Prompt": "",
    "Character 1 UC": "",
    "Character 2 Prompt": "",
    "Character 2 UC": "",
    "Character 3 Prompt": "",
    "Character 3 UC": "",
    "Character 4 Prompt": "",
    "Character 4 UC": "",
    "Character 1 centers": "",
    "Character 2 centers": "",
    "Character 3 centers": "",
    "Character 4 centers": "",
    "Character 1 coordinates": {},
    "Character 2 coordinates": {},
    "Character 3 coordinates": {},
    "Character 4 coordinates": {}
  };
  const sceneMatch = promptString.match(/Scene Composition:([^;]+);/);
  if (sceneMatch) {
    result["Scene Composition"] = deduplicateTags(sceneMatch[1].trim());
  }
  for (let i = 1; i <= 4; i++) {
    const promptMatch = promptString.match(new RegExp(`Character ${i} Prompt:(.*?)(?:\\s*\\|\\s*centers:(\\{[^}]+\\}|[^;\\s]+))?\\s*;`));
    if (promptMatch) {
      result[`Character ${i} Prompt`] = deduplicateTags(promptMatch[1].trim());
      if (promptMatch[2]) {
        result[`Character ${i} centers`] = promptMatch[2].trim();
        result[`Character ${i} coordinates`] = centersToCoordinates(promptMatch[2].trim());
      } else {
        result[`Character ${i} coordinates`] = {
          // x:  0.5,
          // y: y2
        };
      }
    }
    const ucMatch = promptString.match(new RegExp(`Character ${i} UC:([^;]+);`));
    if (ucMatch) {
      result[`Character ${i} UC`] = ucMatch[1].trim();
    }
  }
  addLog(`\u89E3\u6790\u7ED3\u679C: ${JSON.stringify(result, null, 2)}`);
  return result;
}

function centersToCoordinates(centers) {
  if (!centers || typeof centers !== "string") return {};
  const trimmed = centers.trim();
  const coordMatch = trimmed.match(/^\{?\s*([-+]?[0-9.]+)\s*[,，]\s*([-+]?[0-9.]+)\s*\}?$/);
  if (coordMatch) {
    const x = parseFloat(coordMatch[1]);
    const y = parseFloat(coordMatch[2]);
    if (!isNaN(x) && !isNaN(y)) {
      const clampedX = Math.min(1, Math.max(0, x));
      const clampedY = Math.min(1, Math.max(0, y));
      return {
        x: Number(clampedX.toFixed(3)),
        y: Number(clampedY.toFixed(3))
      };
    }
  }
  const match = trimmed.match(/([a-e])([1-5])/i);
  if (!match) return {};
  const column = match[1].toLowerCase();
  const row = parseInt(match[2], 10);
  const columnMap = {
    "a": 0.1,
    "b": 0.3,
    "c": 0.5,
    "d": 0.7,
    "e": 0.9
  };
  const rowMap = {
    1: 0.1,
    2: 0.3,
    3: 0.5,
    4: 0.7,
    5: 0.9
  };
  return {
    x: columnMap[column] || 0.5,
    y: rowMap[row] || 0.5
  };
}

function normalizeName(name) {
  return name.toLowerCase().replace(/-/g, " ").replace(/[''`´]/g, "'").replace(/\s+/g, " ").trim();
}

function calculateMatchScore(inputName, presetName) {
  if (!inputName || !presetName || typeof inputName !== "string" || typeof presetName !== "string") {
    return 0;
  }
  if (inputName === presetName) {
    return 1e3 + presetName.length;
  }
  if (inputName.includes(presetName)) {
    return 100 + presetName.length;
  }
  if (presetName.includes(inputName)) {
    return 50 + inputName.length;
  }
  return 0;
}

function collectCharacterCandidates(inputName, characterPresets, characterIds) {
  const candidates = [];
  for (const charId of characterIds) {
    const char = characterPresets[charId];
    if (!char) continue;
    if (char.nameEN) {
      const names = char.nameEN.split("|");
      for (const name of names) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;
        const normalizedName = normalizeName(trimmedName);
        const score = calculateMatchScore(inputName, normalizedName);
        if (score > 0) {
          candidates.push({
            preset: char,
            score,
            matchedName: trimmedName
          });
        }
      }
    }
    if (char.nameCN) {
      const names = char.nameCN.split("|");
      for (const name of names) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;
        const normalizedName = normalizeName(trimmedName);
        const score = calculateMatchScore(inputName, normalizedName);
        if (score > 0) {
          candidates.push({
            preset: char,
            score,
            matchedName: trimmedName
          });
        }
      }
    }
  }
  return candidates;
}

function collectOutfitCandidates(inputName, outfitPresets, outfitIds) {
  const candidates = [];
  for (const outfitId of outfitIds) {
    const outfit = outfitPresets[outfitId];
    if (!outfit) continue;
    if (outfit.nameEN) {
      const names = outfit.nameEN.split("|");
      for (const name of names) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;
        const normalizedName = normalizeName(trimmedName);
        const score = calculateMatchScore(inputName, normalizedName);
        if (score > 0) {
          candidates.push({
            preset: outfit,
            score,
            matchedName: trimmedName
          });
        }
      }
    }
    if (outfit.nameCN) {
      const names = outfit.nameCN.split("|");
      for (const name of names) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;
        const normalizedName = normalizeName(trimmedName);
        const score = calculateMatchScore(inputName, normalizedName);
        if (score > 0) {
          candidates.push({
            preset: outfit,
            score,
            matchedName: trimmedName
          });
        }
      }
    }
  }
  return candidates;
}

function findBestCharacterMatch(inputName, characterPresets, enabledCharacters, commonCharacters) {
  const presetNames = (entries) => (entries || []).map((entry) => typeof entry === "string" ? entry : entry?.characterPresetName).filter(Boolean);
  enabledCharacters = presetNames(enabledCharacters);
  commonCharacters = presetNames(commonCharacters);
  if (!inputName || typeof inputName !== "string") {
    return null;
  }
  let candidates = collectCharacterCandidates(inputName, characterPresets, enabledCharacters);
  if (candidates.length > 0) {
    const bestMatch = candidates.reduce(
      (best, current) => current.score > best.score ? current : best
    );
    console.log(
      "[CharacterPrompt] Best character match from enabled characters:",
      bestMatch.matchedName,
      "with score:",
      bestMatch.score
    );
    return bestMatch.preset;
  }
  candidates = collectCharacterCandidates(inputName, characterPresets, commonCharacters);
  if (candidates.length > 0) {
    const bestMatch = candidates.reduce(
      (best, current) => current.score > best.score ? current : best
    );
    console.log(
      "[CharacterPrompt] Best character match from common characters:",
      bestMatch.matchedName,
      "with score:",
      bestMatch.score
    );
    return bestMatch.preset;
  }
  const allCharacterIds = Object.keys(characterPresets);
  candidates = collectCharacterCandidates(inputName, characterPresets, allCharacterIds);
  if (candidates.length > 0) {
    const bestMatch = candidates.reduce(
      (best, current) => current.score > best.score ? current : best
    );
    console.log(
      "[CharacterPrompt] Best character match from all presets (fallback):",
      bestMatch.matchedName,
      "with score:",
      bestMatch.score
    );
    return bestMatch.preset;
  }
  return null;
}

function findBestOutfitMatch(inputName, outfitPresets, enabledOutfits, allOutfitIds) {
  if (!inputName || typeof inputName !== "string") {
    return null;
  }
  let candidates = collectOutfitCandidates(inputName, outfitPresets, enabledOutfits);
  if (candidates.length > 0) {
    const bestMatch = candidates.reduce(
      (best, current) => current.score > best.score ? current : best
    );
    console.log(
      "[CharacterPrompt] Best outfit match from enabled outfits:",
      bestMatch.matchedName,
      "with score:",
      bestMatch.score
    );
    return bestMatch.preset;
  }
  candidates = collectOutfitCandidates(inputName, outfitPresets, allOutfitIds);
  if (candidates.length > 0) {
    const bestMatch = candidates.reduce(
      (best, current) => current.score > best.score ? current : best
    );
    console.log(
      "[CharacterPrompt] Best outfit match from all presets (fallback):",
      bestMatch.matchedName,
      "with score:",
      bestMatch.score
    );
    return bestMatch.preset;
  }
  return null;
}

function collectNegativeToGlobal(negative) {
  if (!negative || typeof negative !== "string") {
    return;
  }
  const trimmed = negative.trim();
  if (!trimmed) {
    return;
  }
  if (window.collectedCharacterNegatives) {
    window.collectedCharacterNegatives += ", " + trimmed;
  } else {
    window.collectedCharacterNegatives = trimmed;
  }
  console.log("[CharacterPrompt] \u6536\u96C6\u8D1F\u9762\u63D0\u793A\u8BCD\u5230\u5168\u5C40:", trimmed);
}

function processCharacterPrompt(prompt2) {
  if (!prompt2 || typeof prompt2 !== "string") {
    return prompt2;
  }
  prompt2 = prompt2.replace(/\r?\n/g, ", ");
  window.collectedCharacterNegatives = "";
  if (prompt2.includes("Scene Composition")) {
    console.log("[CharacterPrompt] \u68C0\u6D4B\u5230\u5206\u89D2\u8272\u6A21\u5F0F");
    return processMultiCharacterPrompt(prompt2);
  }
  console.log("[CharacterPrompt] \u4F7F\u7528\u975E\u5206\u89D2\u8272\u6A21\u5F0F");
  const defaultCharacterSettings2 = extension_settings29[extensionName];
  console.log("[CharacterPrompt] Processing prompt:", prompt2);
  const characterPresets = defaultCharacterSettings2.characterPresets || {};
  const outfitPresets = defaultCharacterSettings2.outfitPresets || {};
  const characterEnablePresetId = defaultCharacterSettings2.characterEnablePresetId;
  const characterCommonPresetId = defaultCharacterSettings2.characterCommonPresetId;
  const outfitEnablePresetId = defaultCharacterSettings2.outfitEnablePresetId;
  const enabledCharacters = characterEnablePresetId && defaultCharacterSettings2.characterEnablePresets?.[characterEnablePresetId]?.characters || [];
  const commonCharacters = characterCommonPresetId && defaultCharacterSettings2.characterCommonPresets?.[characterCommonPresetId]?.characters || [];
  const enabledOutfits = outfitEnablePresetId && defaultCharacterSettings2.outfitEnablePresets?.[outfitEnablePresetId]?.outfits || [];
  const characterOutfits = enabledCharacters.flatMap((charId) => characterPresets[charId]?.outfits || []);
  const allAvailableOutfits = [.../* @__PURE__ */ new Set([...enabledOutfits, ...characterOutfits])];
  const outfitNameMap = /* @__PURE__ */ new Map();
  for (const outfitId of allAvailableOutfits) {
    const outfit = outfitPresets[outfitId];
    if (outfit) {
      if (outfit.nameEN) {
        const names = outfit.nameEN.split("|");
        for (const name of names) {
          const trimmedName = name.trim();
          if (trimmedName) {
            outfitNameMap.set(trimmedName, outfit);
          }
        }
      }
      if (outfit.nameCN) {
        const names = outfit.nameCN.split("|");
        for (const name of names) {
          const trimmedName = name.trim();
          if (trimmedName) {
            outfitNameMap.set(trimmedName, outfit);
          }
        }
      }
    }
  }
  let sharedCameraAngle = null;
  let sharedIsFromBehind = false;
  const parseJsonFormat = (content) => {
    try {
      if (content.startsWith("{") && content.endsWith("}")) {
        const parsed = JSON.parse(content);
        if (parsed.name) {
          return {
            isJson: true,
            hasAngle: "angle" in parsed,
            // 用于区分角色(有angle)和服装(无angle)
            name: parsed.name,
            angle: parsed.angle || "",
            upperBody: parsed.upperBody || "hidden",
            // hidden 表示不处理
            lowerBody: parsed.lowerBody || "hidden"
            // hidden 表示不处理
          };
        }
      }
    } catch (e) {
    }
    return { isJson: false };
  };
  const processedPrompt = prompt2.replace(/\$([^$]+)\$/g, (match, content) => {
    const trimmedContent = content.trim();
    const jsonData = parseJsonFormat(trimmedContent);
    if (jsonData.isJson) {
      const normalizedCharacterName = normalizeName(jsonData.name);
      const cameraAngle = jsonData.angle;
      const isFromBehind = cameraAngle.toLowerCase().includes("from behind");
      sharedCameraAngle = cameraAngle;
      sharedIsFromBehind = isFromBehind;
      const upperState = jsonData.upperBody.toLowerCase();
      const lowerState = jsonData.lowerBody.toLowerCase();
      if (jsonData.hasAngle) {
        const character = findBestCharacterMatch(
          normalizedCharacterName,
          characterPresets,
          enabledCharacters,
          commonCharacters
        );
        if (character) {
          let replacement = "";
          if (character.characterTraits) {
            replacement = character.characterTraits;
          }
          if (upperState !== "hidden") {
            const facialField = isFromBehind ? character.facialFeaturesBack || "" : character.facialFeatures || "";
            if (facialField) replacement += (replacement ? ", " : "") + facialField;
            if (upperState === "sfw") {
              const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
              if (field) replacement += (replacement ? ", " : "") + field;
            } else if (upperState === "nsfw") {
              const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
              if (field) replacement += (replacement ? ", " : "") + field;
            }
          }
          if (lowerState !== "hidden") {
            if (lowerState === "sfw") {
              const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
              if (field) replacement += (replacement ? ", " : "") + field;
            } else if (lowerState === "nsfw") {
              const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
              if (field) replacement += (replacement ? ", " : "") + field;
            }
          }
          if (character.negative) {
            collectNegativeToGlobal(character.negative);
          }
          console.log("[CharacterPrompt] JSON Character replacement result:", replacement);
          return replacement;
        }
        return match;
      } else {
        const normalizedOutfitName = normalizeName(jsonData.name);
        const allOutfitIds = Object.keys(outfitPresets);
        const outfit = findBestOutfitMatch(
          normalizedOutfitName,
          outfitPresets,
          allAvailableOutfits,
          allOutfitIds
        );
        if (outfit) {
          let replacement = "";
          if (upperState === "visible") {
            const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
            if (field) replacement = field;
          }
          if (lowerState === "visible") {
            const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
            if (field) replacement += (replacement ? ", " : "") + field;
          }
          console.log("[CharacterPrompt] JSON Outfit replacement result:", replacement);
          return replacement;
        }
        return match;
      }
    }
    const characterFormats = [
      { pattern: "-sfw-upperbody-sfw-lowerbody", upper: "sfw", lower: "sfw" },
      { pattern: "-sfw-upperbody-nsfw-lowerbody", upper: "sfw", lower: "nsfw" },
      { pattern: "-nsfw-upperbody-sfw-lowerbody", upper: "nsfw", lower: "sfw" },
      { pattern: "-nsfw-upperbody-nsfw-lowerbody", upper: "nsfw", lower: "nsfw" },
      { pattern: "-sfw-upperbody-sfw-fullbody", upper: "sfw", lower: "sfw" },
      { pattern: "-sfw-upperbody-nsfw-fullbody", upper: "sfw", lower: "nsfw" },
      { pattern: "-nsfw-upperbody-sfw-fullbody", upper: "nsfw", lower: "sfw" },
      { pattern: "-nsfw-upperbody-nsfw-fullbody", upper: "nsfw", lower: "nsfw" },
      { pattern: "-sfw-upperbody", upper: "sfw", lower: null },
      { pattern: "-nsfw-upperbody", upper: "nsfw", lower: null },
      { pattern: "-sfw-lowerbody", upper: null, lower: "sfw" },
      { pattern: "-nsfw-lowerbody", upper: null, lower: "nsfw" }
    ];
    for (const format of characterFormats) {
      if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
        const nameAndAngle = trimmedContent.slice(0, -format.pattern.length).trim();
        const normalizedCharacterName = normalizeName(nameAndAngle);
        const cameraAngle = nameAndAngle;
        const isFromBehind = cameraAngle.toLowerCase().includes("from behind");
        sharedCameraAngle = cameraAngle;
        sharedIsFromBehind = isFromBehind;
        const character = findBestCharacterMatch(
          normalizedCharacterName,
          characterPresets,
          enabledCharacters,
          commonCharacters
        );
        if (character) {
          let replacement = "";
          if (character.characterTraits) {
            replacement = character.characterTraits;
          }
          if (format.upper) {
            const facialField = isFromBehind ? character.facialFeaturesBack || "" : character.facialFeatures || "";
            if (facialField) replacement += (replacement ? ", " : "") + facialField;
          }
          if (format.upper === "sfw") {
            const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
            if (field) replacement += (replacement ? ", " : "") + field;
          } else if (format.upper === "nsfw") {
            const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
            if (field) replacement += (replacement ? ", " : "") + field;
          }
          if (format.lower === "sfw") {
            const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
            if (field) replacement += (replacement ? ", " : "") + field;
          } else if (format.lower === "nsfw") {
            const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
            if (field) replacement += (replacement ? ", " : "") + field;
          }
          if (character.negative) {
            collectNegativeToGlobal(character.negative);
          }
          console.log("[CharacterPrompt] Character replacement result:", replacement);
          return replacement;
        }
        return match;
      }
    }
    const outfitFormats = [
      { pattern: "-upperbody-lowerbody", hasUpper: true, hasLower: true },
      { pattern: "-upperbody", hasUpper: true, hasLower: false },
      { pattern: "-lowerbody", hasUpper: false, hasLower: true }
    ];
    for (const format of outfitFormats) {
      if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
        const rawOutfitName = trimmedContent.slice(0, -format.pattern.length).trim();
        const normalizedOutfitName = normalizeName(rawOutfitName);
        const allOutfitIds = Object.keys(outfitPresets);
        const outfit = findBestOutfitMatch(
          normalizedOutfitName,
          outfitPresets,
          allAvailableOutfits,
          allOutfitIds
        );
        if (outfit) {
          let replacement = "";
          if (format.hasUpper) {
            const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
            if (field) replacement = field;
          }
          if (format.hasLower) {
            const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
            if (field) replacement += (replacement ? ", " : "") + field;
          }
          console.log("[CharacterPrompt] Outfit replacement result:", replacement);
          return replacement;
        }
        return match;
      }
    }
    return match;
  });
  let finalPrompt = processedPrompt.replace(/\r?\n/g, ", ");
  return finalPrompt.replace(/, \s*,/g, ",").replace(/,+/g, ",").replace(/^, |, $/g, "").trim();
}

function processMultiCharacterPrompt(prompt2) {
  try {
    const prompt_data = parsePromptStringWithCoordinates(prompt2);
    console.log("[CharacterPrompt] \u89E3\u6790\u540E\u7684 prompt_data:", prompt_data);
    const defaultCharacterSettings2 = extension_settings29[extensionName];
    const characterPresets = defaultCharacterSettings2.characterPresets || {};
    const outfitPresets = defaultCharacterSettings2.outfitPresets || {};
    const characterEnablePresetId = defaultCharacterSettings2.characterEnablePresetId;
    const characterCommonPresetId = defaultCharacterSettings2.characterCommonPresetId;
    const outfitEnablePresetId = defaultCharacterSettings2.outfitEnablePresetId;
    const enabledCharacters = characterEnablePresetId && defaultCharacterSettings2.characterEnablePresets?.[characterEnablePresetId]?.characters || [];
    const commonCharacters = characterCommonPresetId && defaultCharacterSettings2.characterCommonPresets?.[characterCommonPresetId]?.characters || [];
    const enabledOutfits = outfitEnablePresetId && defaultCharacterSettings2.outfitEnablePresets?.[outfitEnablePresetId]?.outfits || [];
    const characterOutfits = enabledCharacters.flatMap((charId) => characterPresets[charId]?.outfits || []);
    const allAvailableOutfits = [.../* @__PURE__ */ new Set([...enabledOutfits, ...characterOutfits])];
    for (let i = 1; i <= 4; i++) {
      const promptKey = `Character ${i} Prompt`;
      const ucKey = `Character ${i} UC`;
      if (prompt_data[promptKey]) {
        console.log(`[CharacterPrompt] \u5904\u7406 ${promptKey}:`, prompt_data[promptKey]);
        const negatives = [];
        let sharedIsFromBehind = false;
        const replacedPrompt = prompt_data[promptKey].replace(/\$([^$]+)\$/g, (match, content) => {
          const trimmedContent = content.trim();
          const parseJsonFormat = (content2) => {
            try {
              if (content2.startsWith("{") && content2.endsWith("}")) {
                const parsed = JSON.parse(content2);
                if (parsed.name) {
                  return {
                    isJson: true,
                    hasAngle: "angle" in parsed,
                    name: parsed.name,
                    angle: parsed.angle || "",
                    upperBody: parsed.upperBody || "hidden",
                    lowerBody: parsed.lowerBody || "hidden"
                  };
                }
              }
            } catch (e) {
            }
            return { isJson: false };
          };
          const jsonData = parseJsonFormat(trimmedContent);
          if (jsonData.isJson && jsonData.hasAngle) {
            const normalizedCharacterName = normalizeName(jsonData.name);
            const isFromBehind = jsonData.angle.toLowerCase().includes("from behind");
            sharedIsFromBehind = isFromBehind;
            const character = findBestCharacterMatch(
              normalizedCharacterName,
              characterPresets,
              enabledCharacters,
              commonCharacters
            );
            if (character) {
              if (character.negative) {
                negatives.push(character.negative.trim());
                console.log(`[CharacterPrompt] \u6536\u96C6\u8D1F\u9762\u63D0\u793A\u8BCD:`, character.negative.trim());
              }
              let replacement = "";
              if (character.characterTraits) {
                replacement = character.characterTraits;
              }
              const upperState = jsonData.upperBody.toLowerCase();
              const lowerState = jsonData.lowerBody.toLowerCase();
              if (upperState !== "hidden") {
                const facialField = isFromBehind ? character.facialFeaturesBack || "" : character.facialFeatures || "";
                if (facialField) replacement += (replacement ? ", " : "") + facialField;
                if (upperState === "sfw") {
                  const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
                  if (field) replacement += (replacement ? ", " : "") + field;
                } else if (upperState === "nsfw") {
                  const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
                  if (field) replacement += (replacement ? ", " : "") + field;
                }
              }
              if (lowerState !== "hidden") {
                if (lowerState === "sfw") {
                  const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
                  if (field) replacement += (replacement ? ", " : "") + field;
                } else if (lowerState === "nsfw") {
                  const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
                  if (field) replacement += (replacement ? ", " : "") + field;
                }
              }
              return replacement;
            }
          } else if (jsonData.isJson && !jsonData.hasAngle) {
            const normalizedOutfitName = normalizeName(jsonData.name);
            const allOutfitIds = Object.keys(outfitPresets);
            const outfit = findBestOutfitMatch(
              normalizedOutfitName,
              outfitPresets,
              allAvailableOutfits,
              allOutfitIds
            );
            if (outfit) {
              let replacement = "";
              const upperState = jsonData.upperBody.toLowerCase();
              const lowerState = jsonData.lowerBody.toLowerCase();
              if (upperState === "visible") {
                const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
                if (field) replacement = field;
              }
              if (lowerState === "visible") {
                const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
                if (field) replacement += (replacement ? ", " : "") + field;
              }
              console.log("[CharacterPrompt] JSON Outfit replacement result (multi-char mode):", replacement);
              return replacement;
            }
            return match;
          } else {
            const characterFormats = [
              { pattern: "-sfw-upperbody-sfw-lowerbody", upper: "sfw", lower: "sfw" },
              { pattern: "-sfw-upperbody-nsfw-lowerbody", upper: "sfw", lower: "nsfw" },
              { pattern: "-nsfw-upperbody-sfw-lowerbody", upper: "nsfw", lower: "sfw" },
              { pattern: "-nsfw-upperbody-nsfw-lowerbody", upper: "nsfw", lower: "nsfw" },
              { pattern: "-sfw-upperbody-sfw-fullbody", upper: "sfw", lower: "sfw" },
              { pattern: "-sfw-upperbody-nsfw-fullbody", upper: "sfw", lower: "nsfw" },
              { pattern: "-nsfw-upperbody-sfw-fullbody", upper: "nsfw", lower: "sfw" },
              { pattern: "-nsfw-upperbody-nsfw-fullbody", upper: "nsfw", lower: "nsfw" },
              { pattern: "-sfw-upperbody", upper: "sfw", lower: null },
              { pattern: "-nsfw-upperbody", upper: "nsfw", lower: null },
              { pattern: "-sfw-lowerbody", upper: null, lower: "sfw" },
              { pattern: "-nsfw-lowerbody", upper: null, lower: "nsfw" }
            ];
            for (const format of characterFormats) {
              if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
                const nameAndAngle = trimmedContent.slice(0, -format.pattern.length).trim();
                const normalizedCharacterName = normalizeName(nameAndAngle);
                const isFromBehind = nameAndAngle.toLowerCase().includes("from behind");
                sharedIsFromBehind = isFromBehind;
                const character = findBestCharacterMatch(
                  normalizedCharacterName,
                  characterPresets,
                  enabledCharacters,
                  commonCharacters
                );
                if (character) {
                  if (character.negative) {
                    negatives.push(character.negative.trim());
                    console.log(`[CharacterPrompt] \u6536\u96C6\u8D1F\u9762\u63D0\u793A\u8BCD:`, character.negative.trim());
                  }
                  let replacement = "";
                  if (character.characterTraits) {
                    replacement = character.characterTraits;
                  }
                  if (format.upper) {
                    const facialField = isFromBehind ? character.facialFeaturesBack || "" : character.facialFeatures || "";
                    if (facialField) replacement += (replacement ? ", " : "") + facialField;
                  }
                  if (format.upper === "sfw") {
                    const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
                    if (field) replacement += (replacement ? ", " : "") + field;
                  } else if (format.upper === "nsfw") {
                    const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
                    if (field) replacement += (replacement ? ", " : "") + field;
                  }
                  if (format.lower === "sfw") {
                    const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
                    if (field) replacement += (replacement ? ", " : "") + field;
                  } else if (format.lower === "nsfw") {
                    const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
                    if (field) replacement += (replacement ? ", " : "") + field;
                  }
                  return replacement;
                }
                return match;
              }
            }
            const outfitFormats = [
              { pattern: "-upperbody-lowerbody", hasUpper: true, hasLower: true },
              { pattern: "-upperbody", hasUpper: true, hasLower: false },
              { pattern: "-lowerbody", hasUpper: false, hasLower: true }
            ];
            for (const format of outfitFormats) {
              if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
                const rawOutfitName = trimmedContent.slice(0, -format.pattern.length).trim();
                const normalizedOutfitName = normalizeName(rawOutfitName);
                const allOutfitIds = Object.keys(outfitPresets);
                const outfit = findBestOutfitMatch(
                  normalizedOutfitName,
                  outfitPresets,
                  allAvailableOutfits,
                  allOutfitIds
                );
                if (outfit) {
                  let replacement = "";
                  if (format.hasUpper) {
                    const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
                    if (field) replacement = field;
                  }
                  if (format.hasLower) {
                    const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
                    if (field) replacement += (replacement ? ", " : "") + field;
                  }
                  return replacement;
                }
                return match;
              }
            }
          }
          return match;
        });
        prompt_data[promptKey] = replacedPrompt;
        if (negatives.length > 0) {
          const negativesStr = negatives.join(", ");
          if (prompt_data[ucKey]) {
            prompt_data[ucKey] += ", " + negativesStr;
          } else {
            prompt_data[ucKey] = negativesStr;
          }
          console.log(`[CharacterPrompt] \u6DFB\u52A0\u8D1F\u9762\u5230 ${ucKey}:`, negativesStr);
        }
      }
    }
    return reconstructPromptString(prompt_data);
  } catch (error) {
    console.error("[CharacterPrompt] \u5206\u89D2\u8272\u6A21\u5F0F\u5904\u7406\u5931\u8D25:", error);
    console.log("[CharacterPrompt] \u964D\u7EA7\u5230\u975E\u5206\u89D2\u8272\u6A21\u5F0F");
    return processCharacterPrompt(prompt2.replace("Scene Composition", "SceneComposition"));
  }
}

function reconstructPromptString(prompt_data) {
  if (!prompt_data || typeof prompt_data !== "object") {
    console.error("[CharacterPrompt] prompt_data \u65E0\u6548");
    return "";
  }
  let result = "";
  if (prompt_data["Scene Composition"]) {
    result += `Scene Composition: ${prompt_data["Scene Composition"]};`;
  }
  for (let i = 1; i <= 4; i++) {
    const promptKey = `Character ${i} Prompt`;
    const ucKey = `Character ${i} UC`;
    const centersKey = `Character ${i} centers`;
    if (prompt_data[promptKey]) {
      result += ` ${promptKey}: ${prompt_data[promptKey]}`;
      if (prompt_data[centersKey]) {
        result += `|centers:${prompt_data[centersKey]}`;
      }
      result += ";";
    }
    if (prompt_data[ucKey]) {
      result += ` ${ucKey}: ${prompt_data[ucKey]};`;
    }
  }
  result = result.replace(/\r?\n/g, ", ");
  const finalResult = result.trim();
  console.log("[CharacterPrompt] \u91CD\u7EC4\u540E\u7684 prompt:", finalResult);
  return finalResult;
}

function preprocessTagContent3(content) {
  let processed = content.replace(/：/g, ":").replace(/，/g, ",");
  processed = processed.replace(/下半身NSWebcam:/g, "\u4E0B\u534A\u8EABNSFW\u80CC\u9762:");
  processed = processed.replace(/下半身NSFW_背面:/g, "\u4E0B\u534A\u8EABNSFW\u80CC\u9762:");
  processed = processed.replace(/上半身NSFW_背面:/g, "\u4E0A\u534A\u8EABNSFW\u80CC\u9762:");
  return processed;
}

function parseCharacterData2(content) {
  const lines = content.split("\n").map((line) => line.trim()).filter((line) => line);
  const data = {
    nameCN: "",
    nameEN: "",
    characterTraits: "",
    // 角色特征
    facialFeatures: "",
    facialFeaturesBack: "",
    upperBodySFW: "",
    upperBodySFWBack: "",
    fullBodySFW: "",
    fullBodySFWBack: "",
    upperBodyNSFW: "",
    upperBodyNSFWBack: "",
    fullBodyNSFW: "",
    fullBodyNSFWBack: ""
  };
  const fieldMap = {
    "\u4E2D\u6587\u540D\u79F0": "nameCN",
    "\u82F1\u6587\u540D\u79F0": "nameEN",
    "\u89D2\u8272\u7279\u5F81": "characterTraits",
    "\u4E94\u5B98\u5916\u8C8C": "facialFeatures",
    "\u4E94\u5B98\u5916\u8C8C\u80CC\u9762": "facialFeaturesBack",
    "\u4E0A\u534A\u8EABSFW": "upperBodySFW",
    "\u4E0A\u534A\u8EABSFW\u80CC\u9762": "upperBodySFWBack",
    "\u4E0B\u534A\u8EABSFW": "fullBodySFW",
    "\u4E0B\u534A\u8EABSFW\u80CC\u9762": "fullBodySFWBack",
    "\u4E0A\u534A\u8EABNSFW": "upperBodyNSFW",
    "\u4E0A\u534A\u8EABNSFW\u80CC\u9762": "upperBodyNSFWBack",
    "\u4E0B\u534A\u8EABNSFW": "fullBodyNSFW",
    "\u4E0B\u534A\u8EABNSFW\u80CC\u9762": "fullBodyNSFWBack"
  };
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();
    if (fieldMap[key]) {
      data[fieldMap[key]] = value;
    } else if (key && value) {
      console.log(`ChatU8: \u672A\u8BC6\u522B\u7684\u4EBA\u7269\u5B57\u6BB5 "${key}"`);
    }
  }
  if (!data.nameCN) {
    return null;
  }
  console.log("ChatU8: \u89E3\u6790\u5230\u7684\u4EBA\u7269\u6570\u636E:", data);
  return data;
}

function parseOutfitData3(content) {
  const lines = content.split("\n").map((line) => line.trim()).filter((line) => line);
  const data = {
    nameCN: "",
    nameEN: "",
    owner: "",
    // 归属人（英文名称）
    upperBody: "",
    upperBodyBack: "",
    fullBody: "",
    fullBodyBack: ""
  };
  const fieldMap = {
    "\u5F52\u5C5E\u4EBA": "owner",
    "\u4E2D\u6587\u540D\u79F0": "nameCN",
    "\u82F1\u6587\u540D\u79F0": "nameEN",
    "\u4E0A\u534A\u8EAB": "upperBody",
    "\u4E0A\u534A\u8EAB\u80CC\u9762": "upperBodyBack",
    "\u4E0B\u534A\u8EAB": "fullBody",
    "\u4E0B\u534A\u8EAB\u80CC\u9762": "fullBodyBack"
  };
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();
    if (fieldMap[key]) {
      data[fieldMap[key]] = value;
    } else if (key && value) {
      console.log(`ChatU8: \u672A\u8BC6\u522B\u7684\u670D\u88C5\u5B57\u6BB5 "${key}"`);
    }
  }
  if (!data.nameCN) {
    return null;
  }
  console.log("ChatU8: \u89E3\u6790\u5230\u7684\u670D\u88C5\u6570\u636E:", data);
  return data;
}

function extractCharacterAndOutfitTags2(message) {
  const items = [];
  const combinedRegex = /<(人物|服装)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = combinedRegex.exec(message)) !== null) {
    const type = match[1];
    const content = preprocessTagContent3(match[2]);
    const position = match.index;
    if (type === "\u4EBA\u7269") {
      const parsed = parseCharacterData2(content);
      if (parsed) {
        items.push({ type: "character", data: parsed, position, matchedOutfits: [] });
      }
    } else if (type === "\u670D\u88C5") {
      const parsed = parseOutfitData3(content);
      if (parsed) {
        items.push({ type: "outfit", data: parsed, position });
      }
    }
  }
  items.sort((a, b) => a.position - b.position);
  let currentCharacter = null;
  const characters = [];
  const orphanOutfits = [];
  for (const item of items) {
    if (item.type === "character") {
      currentCharacter = item;
      characters.push(item);
    } else if (item.type === "outfit") {
      if (currentCharacter) {
        currentCharacter.matchedOutfits.push(item.data);
      } else {
        orphanOutfits.push(item.data);
      }
    }
  }
  return {
    characters: characters.map((c) => ({ ...c.data, matchedOutfits: c.matchedOutfits })),
    outfits: orphanOutfits
  };
}

function detectImportFormat(data) {
  if (Array.isArray(data) && data.length > 0 && data[0].worldBooks) {
    return "worldBooksArrayOuter";
  }
  if (data.worldBooks && Array.isArray(data.worldBooks)) {
    return "worldBooks";
  }
  if (!Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length > 0) {
      const firstValue = data[keys[0]];
      if (firstValue && (firstValue.entries || firstValue.history)) {
        return "standard";
      }
    }
  }
  return "unknown";
}
