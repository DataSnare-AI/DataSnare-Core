"use strict";

(function (root) {
  const historyKey = "datasnare-packet-filter-history-v1";
  const fields = new Map();
  const protocols = new Map();
  const STRING_VALUE_LIMIT = 512;
  const MATCH_PATTERN_LIMIT = 64;
  function canonicalIp(value) {
    const address = String(value);
    if (address.includes(":")) {
      try { return new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase(); } catch (_) { return null; }
    }
    const parts = address.split(".");
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
      ? parts.map(Number).join(".") : null;
  }
  function registerField(name, definition) { fields.set(name.toLowerCase(), definition); }
  function registerProtocol(name, predicate) { protocols.set(name.toLowerCase(), predicate); }
  function fieldOperators(definition) {
    if (definition.type === "ip") return ["==", "!=", "in"];
    if (definition.type === "string") return ["==", "!=", "starts_with", "matches"];
    return ["==", "!=", "<", "<=", ">", ">="];
  }
  function ipInteger(value) {
    const address = canonicalIp(value);
    if (!address) return null;
    if (!address.includes(":")) return { version: 4, bits: 32, value: address.split(".").reduce((result, part) => (result << 8n) | BigInt(part), 0n) };
    const halves = address.split("::");
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
    const groups = halves.length > 1 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
    if (groups.length !== 8) return null;
    return { version: 6, bits: 128, value: groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group || "0"}`), 0n) };
  }
  function parseCidr(value, version) {
    const match = /^(.+)\/(\d{1,3})$/.exec(String(value));
    if (!match) throw new Error(`Expected an IPv${version} CIDR network, such as ${version === 4 ? "10.0.0.0/8" : "2001:db8::/32"}.`);
    const network = ipInteger(match[1]);
    const prefix = Number(match[2]);
    if (!network || network.version !== version || prefix > network.bits)
      throw new Error(`Expected a valid IPv${version} CIDR prefix from 0 to ${version === 4 ? 32 : 128}.`);
    const shift = BigInt(network.bits - prefix);
    return { ...network, prefix, network: (network.value >> shift) << shift };
  }
  function compileSafePattern(pattern) {
    if (!pattern || pattern.length > MATCH_PATTERN_LIMIT) throw new Error(`matches patterns must contain 1 to ${MATCH_PATTERN_LIMIT} characters.`);
    if (/[()|{}]/.test(pattern) || /\\[1-9]/.test(pattern)) throw new Error("matches supports no groups, alternation, braces, or backreferences.");
    let quantifiers = 0;
    let inClass = false;
    for (let index = 0; index < pattern.length; index++) {
      const character = pattern[index];
      if (character === "\\") { index++; continue; }
      if (character === "[") inClass = true;
      else if (character === "]") inClass = false;
      else if (!inClass && "*+?".includes(character)) quantifiers++;
    }
    if (inClass || quantifiers > 1) throw new Error("matches allows one repetition operator and requires closed character classes.");
    try { return new RegExp(pattern, "i"); }
    catch (_) { throw new Error("Invalid matches pattern."); }
  }
  function registerDecodedNumber(name, property, max, description, eligible) {
    registerField(name, { type: "number", max, description,
      get: packet => eligible(packet) && Number.isFinite(packet[property]) ? [packet[property]] : [] });
  }
  function networkVersion(packet) {
    if (packet.ipVersion === 4 || packet.ipVersion === 6) return packet.ipVersion;
    if (packet.protocol === "ARP") return null;
    if (Number.isFinite(packet.ipTtl)) return 4;
    if (packet.transport || ["ICMP", "ICMPv6", "IPv4 Fragment"].includes(packet.protocol)) {
      return canonicalIp(packet.src) ? String(packet.src).includes(":") ? 6 : 4 : null;
    }
    return null;
  }
  for (const [prefix, version] of [["ip", 4], ["ipv6", 6]]) {
    registerProtocol(prefix, packet => networkVersion(packet) === version);
    for (const [suffix, properties] of [["src", ["src"]], ["dst", ["dst"]], ["dest", ["dst"]], ["addr", ["src", "dst"]]]) {
      const endpoint = suffix === "src" ? "source" : suffix === "addr" ? "source or destination" : "destination";
      registerField(`${prefix}.${suffix}`, { type: "ip", version, suggestValues: true,
        description: `IPv${version} ${endpoint} address`,
        get: packet => networkVersion(packet) === version ? properties.map(property => packet[property]) : [] });
    }
  }
  for (const transport of ["tcp", "udp"]) {
    registerProtocol(transport, packet => packet.transport?.toLowerCase() === transport);
    for (const [suffix, properties] of [["srcport", ["srcPort"]], ["dstport", ["dstPort"]], ["port", ["srcPort", "dstPort"]]]) {
      const endpoint = suffix === "srcport" ? "source" : suffix === "port" ? "source or destination" : "destination";
      registerField(`${transport}.${suffix}`, { type: "number", max: 65535, suggestValues: true,
        description: `${transport.toUpperCase()} ${endpoint} port`,
        get: packet => packet.transport?.toLowerCase() === transport ? properties.map(property => packet[property]) : [] });
    }
  }
  registerField("frame.number", { type: "number", max: Number.MAX_SAFE_INTEGER, description: "Capture frame number", get: packet => [packet.number] });
  registerField("frame.len", { type: "number", max: Number.MAX_SAFE_INTEGER, description: "Captured frame length in bytes", get: packet => [packet.length] });
  for (const [name, displayed] of [["tds", "TDS"], ["dns", "DNS"], ["http", "HTTP"], ["http2", "HTTP/2"],
    ["quic", "QUIC"], ["smb2", "SMB2"], ["arp", "ARP"], ["icmp", "ICMP"], ["icmpv6", "ICMPv6"], ["dcerpc", "DCE/RPC"]]) {
    registerProtocol(name, packet => packet.protocol === displayed);
  }
  registerProtocol("smb", packet => String(packet.protocol).startsWith("SMB"));
  registerProtocol("tls", packet => packet.protocol === "TLS" || Number.isFinite(packet.tlsRecordType));
  registerDecodedNumber("http.status", "httpStatus", 999, "Decoded HTTP response status", packet => packet.protocol === "HTTP");
  registerDecodedNumber("tds.error_count", "tdsErrorCount", Number.MAX_SAFE_INTEGER, "Decoded TDS error-token count", packet => packet.protocol === "TDS");
  registerDecodedNumber("smb.status", "smbStatus", 0xffffffff, "Decoded SMB2 response status", packet => packet.protocol === "SMB2" && packet.smbResponse === true);
  registerDecodedNumber("icmp.type", "icmpType", 255, "Decoded ICMPv4 type", packet => packet.protocol === "ICMP");
  registerDecodedNumber("icmp.code", "icmpCode", 255, "Decoded ICMPv4 code", packet => packet.protocol === "ICMP");
  registerDecodedNumber("icmpv6.type", "icmpType", 255, "Decoded ICMPv6 type", packet => packet.protocol === "ICMPv6");
  registerDecodedNumber("icmpv6.code", "icmpCode", 255, "Decoded ICMPv6 code", packet => packet.protocol === "ICMPv6");
  registerDecodedNumber("tls.record_type", "tlsRecordType", 255, "Decoded TLS record type", packet => protocols.get("tls")(packet));
  registerDecodedNumber("tls.alert_level", "tlsAlertLevel", 255, "Decoded TLS alert level", packet => protocols.get("tls")(packet) && packet.tlsRecordType === 21);
  registerDecodedNumber("tls.alert_description", "tlsAlertDescription", 255, "Decoded TLS alert description", packet => protocols.get("tls")(packet) && packet.tlsRecordType === 21);
  for (const [name, property, protocol, description] of [
    ["http.host", "httpHost", "HTTP", "Decoded HTTP Host header"],
    ["http.uri", "httpUri", "HTTP", "Decoded HTTP request target"],
    ["dns.name", "dnsName", "DNS", "Decoded DNS question name"],
    ["tds.type", "tdsType", "TDS", "Decoded TDS packet type"],
    ["smb.command", "smbCommand", "SMB2", "Decoded SMB2 command"]
  ]) registerField(name, { type: "string", description,
    get: packet => packet.protocol === protocol && typeof packet[property] === "string" && packet[property]
      ? [packet[property]] : [] });

  function displayAtom(tokens, position) {
    const name = String(tokens[position.cursor++]).toLowerCase();
    const field = fields.get(name);
    if (!field) {
      const protocol = protocols.get(name);
      if (!protocol) throw new Error(`Unknown field or protocol: ${name}.`);
      return protocol;
    }
    const operator = String(tokens[position.cursor++] || "").toLowerCase();
    if (!fieldOperators(field).includes(operator)) throw new Error(`Unsupported operator ${operator} for ${name}.`);
    const literal = tokens[position.cursor++];
    if (!literal) throw new Error(`Expected value after ${operator}.`);
    const quoted = literal.startsWith('"');
    const raw = quoted ? JSON.parse(literal) : literal;
    let expected;
    if (field.type === "ip") {
      if (operator === "in") expected = parseCidr(raw, field.version);
      else {
        expected = canonicalIp(raw);
        if (!expected || (expected.includes(":") ? 6 : 4) !== field.version) throw new Error(`Expected IPv${field.version} address for ${name}.`);
      }
    } else if (field.type === "string") {
      if (!quoted) throw new Error(`Expected a quoted string for ${name}.`);
      if (raw.length > STRING_VALUE_LIMIT) throw new Error(`String filter values are limited to ${STRING_VALUE_LIMIT} characters.`);
      expected = operator === "matches" ? compileSafePattern(raw) : raw.toLowerCase();
    } else {
      if (!/^\d+$/.test(String(raw))) throw new Error(`Expected a nonnegative integer for ${name}.`);
      expected = Number(raw);
      if (!Number.isSafeInteger(expected) || expected > field.max) throw new Error(`Value out of range for ${name}.`);
    }
    return packet => {
      const values = field.get(packet).filter(value => value != null)
        .map(value => field.type === "ip" ? canonicalIp(value) : field.type === "string" ? String(value).toLowerCase() : value).filter(value => value != null);
      if (!values.length) return false;
      if (operator === "!=") return values.every(value => value !== expected);
      if (operator === "in") return values.some(value => {
        const address = ipInteger(value);
        if (!address || address.version !== expected.version) return false;
        const shift = BigInt(address.bits - expected.prefix);
        return (address.value >> shift) === (expected.network >> shift);
      });
      if (operator === "starts_with") return values.some(value => value.startsWith(expected));
      if (operator === "matches") return values.some(value => expected.test(value.slice(0, STRING_VALUE_LIMIT)));
      return values.some(value => operator === "==" ? value === expected : operator === ">" ? value > expected
        : operator === ">=" ? value >= expected : operator === "<" ? value < expected : value <= expected);
    };
  }

  function compile(expression, mode = "text") {
    const source = String(expression || "").trim();
    if (source.length > 2048) throw new Error("Filter exceeds 2,048 characters.");
    if (!source) return () => true;
    if (mode === "text" && /[=<>]/.test(source)) throw new Error("Select Display Filter mode for field comparisons.");
    const tokens = [];
    const pattern = /\s*(&&|\|\||==|!=|>=|<=|[()!<>]|"(?:\\.|[^"\\])*"|[^\s()!&|"=<>]+)/gy;
    let offset = 0;
    while (offset < source.length) {
      pattern.lastIndex = offset;
      const match = pattern.exec(source);
      if (!match) throw new Error(`Invalid filter near character ${offset + 1}.`);
      tokens.push(match[1]);
      offset = pattern.lastIndex;
      if (tokens.length > 256) throw new Error("Filter exceeds 256 tokens.");
    }
    let cursor = 0;
    const is = (token, names) => names.includes(String(token).toLowerCase());
    function atom(depth) {
      if (depth > 20) throw new Error("Filter grouping exceeds 20 levels.");
      const token = tokens[cursor++];
      if (is(token, ["!", "not"])) {
        const child = atom(depth + 1);
        return text => !child(text);
      }
      if (token === "(") {
        const child = disjunction(depth + 1);
        if (tokens[cursor++] !== ")") throw new Error("Missing closing parenthesis.");
        return child;
      }
      if (!token || is(token, [")", "&&", "||", "and", "or"])) throw new Error("Expected a search term.");
      if (mode === "display") {
        const position = { cursor: cursor - 1 };
        const predicate = displayAtom(tokens, position);
        cursor = position.cursor;
        return predicate;
      }
      const terms = [token];
      while (cursor < tokens.length && !is(tokens[cursor], ["(", ")", "!", "not", "&&", "||", "and", "or"])) terms.push(tokens[cursor++]);
      const term = terms.map(value => value.startsWith('"') ? JSON.parse(value) : value).join(" ").toLowerCase();
      return text => text.includes(term);
    }
    function conjunction(depth) {
      let predicate = atom(depth);
      while (is(tokens[cursor], ["&&", "and"])) {
        cursor++;
        const left = predicate;
        const right = atom(depth);
        predicate = text => left(text) && right(text);
      }
      return predicate;
    }
    function disjunction(depth) {
      let predicate = conjunction(depth);
      while (is(tokens[cursor], ["||", "or"])) {
        cursor++;
        const left = predicate;
        const right = conjunction(depth);
        predicate = text => left(text) || right(text);
      }
      return predicate;
    }
    const predicate = disjunction(0);
    if (cursor !== tokens.length) throw new Error("Unexpected term or parenthesis.");
    return mode === "display" ? predicate : text => predicate(String(text).toLowerCase());
  }

  function packetText(packet, hostName = value => value) {
    return [packet.number, packet.src, packet.dst, hostName(packet.src), hostName(packet.dst), packet.protocol,
      packet.info, packet.processCorrelation?.pid, packet.processCorrelation?.process,
      packet.processCorrelation?.executable, packet.processCorrelation?.user].filter(value => value != null).join(" ");
  }

  function syntaxReference() {
    return {
      fields: [...fields].map(([name, definition]) => ({ name, description: definition.description || `${definition.type} field`, type: definition.type,
        operators: fieldOperators(definition) })),
      protocols: [...protocols.keys()],
      examples: [
        { mode: "text", expression: "Rbt || TDS" },
        { mode: "text", expression: "(Rbt || TDS) && !reset" },
        { mode: "display", expression: "ip.addr == 10.242.88.7 and tds" },
        { mode: "display", expression: "ip.src in 10.242.0.0/16 and http.host starts_with \"api.\"" },
        { mode: "display", expression: "dns.name matches \"^db[0-9]+\\\\.example\\\\.com$\"" },
        { mode: "display", expression: "tcp.port == 1433 && frame.len > 100" },
        { mode: "display", expression: "ipv6.src == 2001:db8::1 and tcp" }
      ]
    };
  }

  function completions(expression, caret = String(expression).length, packets = []) {
    const source = String(expression || "");
    if (source.length > 2048) return [];
    const before = source.slice(0, caret);
    const pattern = /&&|\|\||==|!=|>=|<=|[()!<>]|"(?:\\.|[^"\\])*"|[^\s()!&|"=<>]+|[=&|]/g;
    const tokens = [...before.matchAll(pattern)];
    if (tokens.length > 256) return [];
    let fragment = "";
    let start = caret;
    const last = tokens.at(-1);
    if (last && last.index + last[0].length === caret && !["(", ")", "!"].includes(last[0])) {
      fragment = last[0];
      start = last.index;
      tokens.pop();
    }
    let state = "operand";
    let definition = null;
    let currentOperator = "";
    for (const match of tokens) {
      const token = match[0].toLowerCase();
      if (state === "operand") {
        if (["(", "!", "not"].includes(token)) continue;
        definition = fields.get(token);
        if (definition) state = "operator";
        else if (protocols.has(token)) state = "logical";
        else return [];
      } else if (state === "operator") {
        if (!fieldOperators(definition).includes(token)) return [];
        currentOperator = token;
        state = "value";
      } else if (state === "value") {
        state = "logical";
      } else if (token === ")") {
        continue;
      } else if (["and", "or", "&&", "||"].includes(token)) state = "operand";
      else return [];
    }
    const end = caret + (source.slice(caret).match(/^[^\s()!&|"=<>]+/)?.[0].length || 0);
    if (state === "value") {
      if (currentOperator === "in" || definition?.type === "string" || !definition?.suggestValues
        || source.slice(0, caret).includes('"') || fragment.startsWith('"') || !Array.isArray(packets)) return [];
      const counts = new Map();
      const sampleCount = Math.min(packets.length, 5000);
      const sampleStep = sampleCount > 1 ? (packets.length - 1) / (sampleCount - 1) : 1;
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const packet = packets[Math.floor(sampleIndex * sampleStep)];
        for (const raw of new Set(definition.get(packet) || [])) {
          const value = definition.type === "ip" ? canonicalIp(raw) : Number.isSafeInteger(raw) && raw >= 0 && raw <= definition.max ? String(raw) : null;
          if (value == null || !value.toLowerCase().startsWith(fragment.toLowerCase())) continue;
          if (!counts.has(value) && counts.size >= 256) continue;
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      }
      return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12).map(([value, count]) => ({ value, description: `Observed in sampled packets (${count})`, start, end }));
    }
    if (state === "operand" && protocols.has(fragment.toLowerCase())) return [];
    let options;
    if (state === "operand") {
      options = [...fields].map(([name, field]) => ({ value: name, description: field.description || `${field.type === "ip" ? `IPv${field.version}` : "Integer"} field` }))
        .concat([...protocols.keys()].map(value => ({ value, description: "Protocol present" })),
          [{ value: "not", description: "Negate a predicate" }]);
    } else if (state === "operator") {
      options = fieldOperators(definition).map(value => ({ value, description: value === "==" ? "Exact equality"
        : value === "!=" ? "Not equal" : value === "in" ? "CIDR network membership"
          : value === "starts_with" ? "Case-insensitive string prefix" : value === "matches" ? "Bounded regular expression" : "Numeric comparison" }));
    } else options = [{ value: "and", description: "Both predicates" }, { value: "or", description: "Either predicate" }];
    const matching = options.filter(option => option.value.startsWith(fragment.toLowerCase()));
    if (state === "operand") matching.sort((left, right) => left.value.length - right.value.length);
    return matching.slice(0, 12).map(option => ({ ...option, start, end }));
  }

  function bind(input, apply, getPackets = () => []) {
    let active = compile("");
    let activeMode = "text";
    let appliedSource = "";
    let timer;
    let suggestions = [];
    let selectedSuggestion = 0;
    const popup = document.createElement("div");
    popup.id = `${input.id}Suggestions`;
    popup.className = "packet-filter-suggestions";
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", "Display filter suggestions");
    popup.hidden = true;
    document.body.appendChild(popup);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", popup.id);
    input.setAttribute("aria-expanded", "false");
    function dismissSuggestions() {
      popup.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    function selectSuggestion(index) {
      selectedSuggestion = (index + suggestions.length) % suggestions.length;
      [...popup.children].forEach((option, position) => option.setAttribute("aria-selected", String(position === selectedSuggestion)));
      const option = popup.children[selectedSuggestion];
      input.setAttribute("aria-activedescendant", option.id);
      if (option.offsetTop < popup.scrollTop) popup.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > popup.scrollTop + popup.clientHeight)
        popup.scrollTop = option.offsetTop + option.offsetHeight - popup.clientHeight;
    }
    function acceptSuggestion() {
      const suggestion = suggestions[selectedSuggestion];
      if (!suggestion) return;
      clearTimeout(timer);
      const tail = input.value.slice(suggestion.end);
      const replacement = suggestion.value + (tail.startsWith(" ") ? "" : " ");
      input.setRangeText(replacement, suggestion.start, suggestion.end, "end");
      validate();
      dismissSuggestions();
      input.focus();
    }
    function showSuggestions() {
      if (mode.value !== "display" || document.activeElement !== input) { dismissSuggestions(); return; }
      suggestions = completions(input.value, input.selectionStart ?? input.value.length, getPackets());
      if (!suggestions.length) { dismissSuggestions(); return; }
      popup.replaceChildren();
      suggestions.forEach((suggestion, index) => {
        const option = document.createElement("div");
        option.id = `${popup.id}-${index}`;
        option.setAttribute("role", "option");
        const label = document.createElement("strong");
        label.textContent = suggestion.value;
        const detail = document.createElement("small");
        detail.textContent = suggestion.description;
        option.append(label, detail);
        option.addEventListener("pointerdown", event => {
          if (event.button !== 0) return;
          event.preventDefault();
          selectedSuggestion = index;
          acceptSuggestion();
        });
        popup.appendChild(option);
      });
      const rect = input.getBoundingClientRect();
      popup.style.width = `${Math.min(Math.max(rect.width, 260), innerWidth - 16)}px`;
      popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - parseFloat(popup.style.width) - 8))}px`;
      popup.hidden = false;
      const height = Math.min(popup.scrollHeight, 240);
      popup.style.top = `${rect.bottom + height + 8 <= innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)}px`;
      input.setAttribute("aria-expanded", "true");
      selectSuggestion(0);
    }
    const mode = document.createElement("select");
    mode.id = `${input.id}Mode`;
    mode.className = "packet-filter-history";
    mode.setAttribute("aria-label", input.id === "searchInput" ? "Core filter mode" : "Packets filter mode");
    mode.add(new Option("Text", "text"));
    mode.add(new Option("Display Filter", "display"));
    input.parentElement.insertAdjacentElement("afterend", mode);
    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "text-button";
    applyButton.textContent = "Apply";
    mode.insertAdjacentElement("afterend", applyButton);
    const helpButton = document.createElement("button");
    helpButton.type = "button";
    helpButton.className = "packet-filter-help-button";
    helpButton.textContent = "?";
    helpButton.title = "Filter syntax help";
    helpButton.setAttribute("aria-label", input.id === "searchInput" ? "Core filter syntax help" : "Packets filter syntax help");
    applyButton.insertAdjacentElement("afterend", helpButton);
    const dialog = document.createElement("dialog");
    dialog.className = "packet-filter-help-dialog";
    dialog.setAttribute("aria-label", "Filter syntax help");
    document.body.appendChild(dialog);
    helpButton.addEventListener("click", () => {
      clearTimeout(timer);
      dismissSuggestions();
      dialog.replaceChildren();
      const heading = document.createElement("h2");
      heading.textContent = "Filter syntax";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "button button-quiet";
      close.textContent = "Close";
      close.addEventListener("click", () => dialog.close());
      dialog.append(heading, close);
      function section(title, text) {
        const heading = document.createElement("h3");
        heading.textContent = title;
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        dialog.append(heading, paragraph);
      }
      section("Text", 'Case-insensitive text search includes addresses, mapped hostnames, displayed protocol and Info. Quote phrases or literal operator words, such as "and".');
      section("Grouping", "Use parentheses, && / and, || / or, and ! / not. NOT binds first, then AND, then OR.");
      section("Display Filter", "This is a Wireshark-inspired subset, not full Wireshark syntax. == means exact equality. IP fields also support in with an IPv4/IPv6 CIDR network, for example ip.src in 10.0.0.0/8. Registered text fields http.host, http.uri, dns.name, tds.type and smb.command support quoted, case-insensitive starts_with and matches. matches is a bounded regular-expression subset (64-character patterns, no groups/alternation/backreferences, at most one repetition operator; only the first 512 field characters are scanned). like and general wildcard syntax are not supported. Missing fields do not match comparisons, including !=. ip.addr != X requires neither endpoint to equal X. IP comparisons use addresses, not hostname labels.");
      section("Application And Validation", "Display filters validate while typing and run on Enter or Apply. Text filters apply after a short debounce. Green means valid syntax; red indicates an error and retains the last applied results. History is separate for each mode. Examples below fill the box without applying.");
      const reference = syntaxReference();
      const exampleHeading = document.createElement("h3");
      exampleHeading.textContent = "Examples";
      dialog.appendChild(exampleHeading);
      for (const example of reference.examples) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "packet-filter-example";
        button.textContent = `${example.mode === "display" ? "Display Filter" : "Text"}: ${example.expression}`;
        button.addEventListener("click", () => {
          clearTimeout(timer);
          mode.value = example.mode;
          input.value = example.expression;
          validate();
          refreshHistory();
          dialog.close();
          input.focus();
        });
        dialog.appendChild(button);
      }
      section("Registered Protocols", reference.protocols.join(", "));
      const table = document.createElement("table");
      const caption = document.createElement("caption");
      caption.textContent = "Registered fields and operators";
      table.appendChild(caption);
      const header = document.createElement("tr");
      for (const title of ["Field", "Description", "Type", "Operators"]) {
        const cell = document.createElement("th"); cell.textContent = title; header.appendChild(cell);
      }
      table.appendChild(header);
      for (const field of reference.fields) {
        const row = document.createElement("tr");
        for (const text of [field.name, field.description, field.type, field.operators.join(" ")]) {
          const cell = document.createElement("td"); cell.textContent = text; row.appendChild(cell);
        }
        table.appendChild(row);
      }
      dialog.appendChild(table);
      dialog.showModal();
    });
    const history = document.createElement("select");
    history.className = "packet-filter-history";
    history.setAttribute("aria-label", "Previous packet filters");
    history.title = "Previous packet filters";
    helpButton.insertAdjacentElement("afterend", history);
    const status = document.createElement("span");
    status.className = "packet-filter-status";
    status.setAttribute("role", "status");
    history.insertAdjacentElement("afterend", status);
    function refreshHistory() {
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(mode.value === "display" ? `${historyKey}:display` : historyKey)) || []; } catch (_) {}
      history.replaceChildren(new Option("Previous filters", ""));
      if (Array.isArray(saved)) saved.filter(value => typeof value === "string" && value.length <= 2048).slice(0, 20)
        .forEach(value => history.add(new Option(value, value)));
    }
    function validate() {
      try {
        const predicate = compile(input.value, mode.value);
        input.dataset.filterValidity = input.value.trim() ? "valid" : "empty";
        input.setAttribute("aria-invalid", "false");
        input.title = mode.value === "display" ? "Display filter: ip.addr == 10.0.0.1 and tds; Enter or Apply to run"
          : "Boolean text filter: && / and, || / or, NOT, parentheses and quoted phrases";
        status.textContent = "";
        return predicate;
      } catch (error) {
        input.dataset.filterValidity = "invalid";
        input.setAttribute("aria-invalid", "true");
        input.title = error.message;
        status.textContent = error.message;
        return null;
      }
    }
    function submit(remember) {
      clearTimeout(timer);
      dismissSuggestions();
      const predicate = validate();
      if (!predicate) return;
      active = predicate;
      activeMode = mode.value;
      appliedSource = input.value.trim();
      if (remember && appliedSource) {
        try {
          const key = mode.value === "display" ? `${historyKey}:display` : historyKey;
          const saved = JSON.parse(localStorage.getItem(key)) || [];
          localStorage.setItem(key, JSON.stringify([appliedSource, ...(Array.isArray(saved) ? saved : [])
            .filter(value => typeof value === "string" && value !== appliedSource && value.length <= 2048)].slice(0, 20)));
        } catch (_) {}
        refreshHistory();
      }
      apply();
    }
    input.addEventListener("input", () => {
      clearTimeout(timer);
      if (validate() && mode.value === "text") timer = setTimeout(() => submit(false), 300);
      showSuggestions();
    });
    input.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Escape" && !popup.hidden) { event.preventDefault(); event.stopPropagation(); dismissSuggestions(); return; }
      if (["ArrowDown", "ArrowUp"].includes(event.key) && mode.value === "display") {
        event.preventDefault();
        if (popup.hidden) showSuggestions();
        else selectSuggestion(selectedSuggestion + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (!popup.hidden && ["Enter", "Tab"].includes(event.key)) { event.preventDefault(); acceptSuggestion(); return; }
      if (event.key === "Enter") { event.preventDefault(); submit(true); }
    });
    input.addEventListener("click", showSuggestions);
    input.addEventListener("keyup", event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) showSuggestions(); });
    input.addEventListener("blur", dismissSuggestions);
    window.addEventListener("resize", dismissSuggestions);
    document.addEventListener("scroll", event => {
      if (popup.hidden || popup.contains(event.target)) return;
      const rect = input.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight) dismissSuggestions();
      else showSuggestions();
    }, true);
    history.addEventListener("focus", refreshHistory);
    history.addEventListener("change", () => { if (history.value) { input.value = history.value; submit(true); } });
    applyButton.addEventListener("click", () => submit(true));
    mode.addEventListener("change", () => { clearTimeout(timer); dismissSuggestions(); validate(); refreshHistory(); });
    refreshHistory();
    return { matches: (packet, hostName) => active(activeMode === "display" ? packet : packetText(packet, hostName)),
      restore(savedMode = "text") {
        clearTimeout(timer);
        dismissSuggestions();
        mode.value = savedMode === "display" ? "display" : "text";
        const predicate = validate();
        activeMode = mode.value;
        active = predicate || compile("", activeMode);
        appliedSource = predicate ? input.value.trim() : "";
        refreshHistory();
      },
      get mode() { return activeMode; },
      get expression() { return appliedSource; } };
  }
  const api = { compile, packetText, bind, registerField, registerProtocol, canonicalIp, syntaxReference, completions };
  root.DataSnarePacketFilter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);