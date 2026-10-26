function options(args, flags, valueFlags = []) {
  const enabled = new Set(),
    values = [],
    targets = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      targets.push(...args.slice(i + 1));
      break;
    }
    if (flags.includes(arg)) enabled.add(arg);
    else if (valueFlags.includes(arg)) {
      if (args[i + 1] === undefined) return null;
      values.push([arg, args[++i]]);
    } else if (arg.startsWith("--") && arg.includes("=")) {
      const index = arg.indexOf("=");
      if (!valueFlags.includes(arg.slice(0, index))) return null;
      values.push([arg.slice(0, index), arg.slice(index + 1)]);
    } else if (/^-[^-].+/.test(arg)) {
      for (let part = 1; part < arg.length; part++) {
        const flag = "-" + arg[part];
        if (valueFlags.includes(flag)) {
          const value = arg.slice(part + 1) || args[++i];
          if (value === undefined) return null;
          values.push([flag, value]);
          break;
        }
        if (!flags.includes(flag)) return null;
        enabled.add(flag);
      }
    } else if (arg.startsWith("-")) return null;
    else targets.push(arg);
  }
  return {
    targets,
    has: (...names) => names.some((name) => enabled.has(name)),
    allValues: (...names) =>
      values.filter(([name]) => names.includes(name)).map(([, value]) => value),
    value: (...names) => values.findLast(([name]) => names.includes(name))?.[1],
  };
}

function scope(targets, label = "范围") {
  return targets.length ? `（${label}：${targets.join("、")}）` : "";
}

function gitDescription(args) {
  const directories = [];
  let index = 0;
  while (index < args.length) {
    if (["--no-pager", "--no-optional-locks"].includes(args[index])) index++;
    else if (args[index] === "-C" && args[index + 1]) {
      directories.push(args[index + 1]);
      index += 2;
    } else break;
  }
  const action = args[index++],
    rest = args.slice(index);
  let label;
  if (action === "diff") {
    const parsed = options(
      rest,
      [
        "--check",
        "--stat",
        "--numstat",
        "--shortstat",
        "--name-only",
        "--name-status",
        "--cached",
        "--staged",
        "--no-color",
        "--patch",
        "-p",
        "--exit-code",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-space-at-eol",
        "--ignore-all-space",
        "-w",
        "--ignore-space-change",
        "-b",
        "--no-renames",
      ],
      ["-U", "--unified", "--diff-filter", "--color"],
    );
    if (!parsed) return null;
    const staged = parsed.has("--cached", "--staged") ? "暂存区" : "";
    label = parsed.has("--check")
      ? `检查${staged}差异的空白错误`
      : parsed.has("--numstat")
        ? `查看${staged}差异行数统计`
        : parsed.has("--stat", "--shortstat")
          ? `查看${staged}差异统计`
          : parsed.has("--name-status")
            ? `查看${staged}变更文件及状态`
            : parsed.has("--name-only")
              ? `查看${staged}变更文件`
              : `查看${staged}代码差异`;
    label += scope(parsed.targets);
  } else if (action === "status") {
    const parsed = options(
      rest,
      [
        "-s",
        "--short",
        "-b",
        "--branch",
        "--porcelain",
        "-u",
        "--untracked-files",
        "--ignored",
        "--ahead-behind",
        "--no-ahead-behind",
        "--renames",
        "--no-renames",
      ],
      ["--porcelain", "-u", "--untracked-files", "--ignore-submodules"],
    );
    if (!parsed) return null;
    label = "查看工作区状态" + scope(parsed.targets);
  } else if (action === "log" || action === "show") {
    const logArgs = [];
    let literal = false;
    for (const arg of rest) {
      if (arg === "--") literal = true;
      if (!literal && /^-\d+$/.test(arg)) logArgs.push("-n", arg.slice(1));
      else logArgs.push(arg);
    }
    const parsed = options(
      logArgs,
      [
        "--oneline",
        "--stat",
        "--name-only",
        "--name-status",
        "--no-patch",
        "-s",
        "-p",
        "--decorate",
        "--all",
        "--graph",
        "--date-order",
        "--reverse",
        "--abbrev-commit",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
      ],
      [
        "-n",
        "--max-count",
        "--format",
        "--pretty",
        "--date",
        "--since",
        "--until",
        "--author",
        "--grep",
      ],
    );
    if (!parsed) return null;
    const count = parsed.value("-n", "--max-count");
    if (count !== undefined && !/^\d+$/.test(count)) return null;
    label =
      action === "log"
        ? count
          ? `查看最近 ${count} 条提交记录`
          : "查看提交记录"
        : parsed.has("--stat")
          ? "查看提交变更统计"
          : "查看 Git 对象详情";
    label += scope(parsed.targets);
  } else if (action === "branch") {
    const parsed = options(
      rest,
      [
        "--show-current",
        "-a",
        "--all",
        "-r",
        "--remotes",
        "-v",
        "--verbose",
        "--list",
        "--no-color",
      ],
      ["--sort", "--contains", "--merged", "--no-merged"],
    );
    if (!parsed || (parsed.targets.length && !parsed.has("--list")))
      return null;
    label = parsed.has("--show-current") ? "查看当前分支" : "查看分支列表";
    label += scope(parsed.targets);
  } else if (action === "rev-parse") {
    const parsed = options(rest, [
      "--show-toplevel",
      "--show-prefix",
      "--git-dir",
      "--abbrev-ref",
      "--short",
      "--verify",
      "--is-inside-work-tree",
    ]);
    if (!parsed) return null;
    if (parsed.has("--show-toplevel")) label = "查看仓库根目录";
    else if (parsed.has("--show-prefix")) label = "查看仓库内相对目录";
    else if (parsed.has("--git-dir")) label = "查看 Git 数据目录";
    else if (parsed.has("--is-inside-work-tree"))
      label = "检查当前目录是否属于工作区";
    else if (parsed.has("--abbrev-ref") && parsed.targets.join() === "HEAD")
      label = "查看当前分支";
    else
      label = `查看${parsed.has("--short") ? "提交短哈希" : "Git 引用"}${scope(parsed.targets)}`;
  } else if (action === "ls-files" || action === "check-ignore") {
    const parsed =
      action === "ls-files"
        ? options(rest, [
            "-c",
            "--cached",
            "-m",
            "--modified",
            "-d",
            "--deleted",
            "-o",
            "--others",
            "--exclude-standard",
            "-z",
            "-s",
            "--stage",
            "--error-unmatch",
          ])
        : options(rest, [
            "-v",
            "--verbose",
            "-q",
            "--quiet",
            "--no-index",
            "-z",
          ]);
    if (!parsed) return null;
    label =
      (action === "ls-files" ? "列出 Git 文件" : "检查 Git 忽略规则") +
      scope(parsed.targets);
  } else if (action === "remote") {
    if (
      !rest.length ||
      (rest.length === 1 && ["-v", "--verbose"].includes(rest[0]))
    )
      label = "查看远程仓库";
    else if (rest[0] === "get-url") {
      const parsed = options(rest.slice(1), ["--all", "--push"]);
      if (!parsed) return null;
      label = "查看远程仓库地址" + scope(parsed.targets, "远程");
    }
  }
  return label ? label + scope(directories, "目录") : null;
}

function npmDescription(args) {
  let index = 0;
  const prefix = [];
  while (["--workspace", "-w", "--prefix"].includes(args[index])) {
    if (!args[index + 1]) return null;
    prefix.push(args[index], args[index + 1]);
    index += 2;
  }
  const action = args[index++];
  let script;
  if (action === "run" || action === "run-script") script = args[index++];
  else if (["test", "start", "stop", "restart"].includes(action))
    script = action;
  const parsed = options(
    [...prefix, ...args.slice(index)],
    ["--silent", "-s", "--if-present", "--workspaces"],
    ["--workspace", "-w", "--prefix"],
  );
  if (!parsed) return null;
  let label;
  if (script) {
    const labels = {
      check: "运行项目检查",
      test: "运行测试",
      "test:unit": "运行单元测试",
      "test:components": "运行组件测试",
      "test:package": "运行发行包测试",
      build: "构建项目",
      lint: "检查代码规范",
      typecheck: "检查类型",
      format: "格式化文件",
      "format:check": "检查代码格式",
    };
    label = Object.hasOwn(labels, script)
      ? labels[script]
      : `运行 npm 脚本 ${script}`;
  } else if (action === "ci") label = "按锁文件安装 npm 依赖";
  else if (action === "install" || action === "i") label = "安装 npm 依赖";
  else if (action === "pack") label = "打包 npm 项目";
  else return null;
  const workspaces = parsed.has("--workspaces")
      ? ["全部"]
      : parsed.allValues("--workspace", "-w"),
    directory = parsed.value("--prefix");
  return (
    label +
    scope(workspaces, "工作区") +
    (directory ? scope([directory], "目录") : "") +
    scope(parsed.targets, script ? "参数" : "目标")
  );
}

function queryDescription(name, args) {
  if (name === "ps") {
    const parsed = options(
      args.filter((arg, index) => !(index === 0 && /^[auxwf]+$/.test(arg))),
      ["-e", "-f", "-a", "-x", "-w", "-H", "--forest", "--no-headers", "-T"],
      [
        "-o",
        "--format",
        "-p",
        "--pid",
        "--ppid",
        "-C",
        "-u",
        "--user",
        "--sort",
      ],
    );
    if (!parsed || parsed.targets.length) return null;
    const pid = parsed.value("-p", "--pid"),
      parent = parsed.value("--ppid"),
      executable = parsed.value("-C");
    return parent
      ? `查看进程 ${parent} 的子进程`
      : pid
        ? `查看进程 ${pid}`
        : executable
          ? `查看 ${executable} 进程`
          : "查看进程列表";
  }
  if (name === "pgrep") {
    const parsed = options(
      args,
      ["-a", "-f", "-l", "-i", "-x", "-n", "-o"],
      ["-u", "-P"],
    );
    return parsed?.targets.length
      ? `查找进程 ${parsed.targets.join("、")}`
      : null;
  }
  if (name === "systemctl") {
    const parsed = options(
      args,
      [
        "--user",
        "--system",
        "--no-pager",
        "--plain",
        "--no-legend",
        "--all",
        "-a",
        "--failed",
      ],
      ["--type", "--state", "-p", "--property"],
    );
    if (!parsed) return null;
    const [action, ...services] = parsed.targets;
    const subject = parsed.has("--user") ? "用户服务" : "服务";
    const labels = {
      status: `查看${subject}状态`,
      "is-active": `检查${subject}运行状态`,
      "is-enabled": `检查${subject}启用状态`,
      cat: `读取${subject}配置`,
      show: `查看${subject}属性`,
      "list-units": `列出${subject}`,
      "list-unit-files": `列出${subject}配置`,
    };
    const label = Object.hasOwn(labels, action) ? labels[action] : null;
    return label
      ? label + (services.length ? " " + services.join("、") : "")
      : null;
  }
  if (name === "journalctl") {
    const parsed = options(
      args,
      [
        "--user",
        "--no-pager",
        "-b",
        "--boot",
        "-e",
        "--pager-end",
        "-r",
        "--reverse",
        "-f",
        "--follow",
      ],
      [
        "-u",
        "--unit",
        "--user-unit",
        "-n",
        "--lines",
        "--since",
        "--until",
        "-p",
        "--priority",
        "-o",
        "--output",
      ],
    );
    if (!parsed) return null;
    const units = parsed.allValues("-u", "--unit", "--user-unit"),
      count = parsed.value("-n", "--lines");
    if (count !== undefined && !/^\d+$/.test(count)) return null;
    return `${parsed.has("-f", "--follow") ? "持续查看" : "查看"}${units.length ? "服务日志 " + units.join("、") : "系统日志"}${count ? `（最近 ${count} 行）` : ""}${scope(parsed.targets)}`;
  }
  const fileQueries = {
    du: [
      "查看磁盘占用",
      ["-s", "-h", "-a", "-c", "-k", "-m", "--summarize", "--human-readable"],
      ["-d", "--max-depth"],
    ],
    df: ["查看磁盘空间", ["-h", "-i", "-T", "--human-readable", "--total"]],
    file: ["查看文件类型", ["-b", "-L", "-i", "--mime", "--mime-type"]],
    stat: ["查看文件信息", ["-L", "-f", "--file-system"], ["-c", "--format"]],
  };
  if (Object.hasOwn(fileQueries, name)) {
    const [label, flags, values] = fileQueries[name],
      parsed = options(args, flags, values);
    return parsed
      ? label + (parsed.targets.length ? " " + parsed.targets.join("、") : "")
      : null;
  }
  if ((name === "command" && args[0] === "-v") || name === "which") {
    const parsed = options(name === "command" ? args.slice(1) : args, ["-a"]);
    return parsed?.targets.length
      ? "查找命令位置 " + parsed.targets.join("、")
      : null;
  }
  if (name === "curl") {
    const parsed = options(
      args,
      [
        "-I",
        "--head",
        "-f",
        "--fail",
        "-s",
        "--silent",
        "-S",
        "--show-error",
        "-L",
        "--location",
        "--compressed",
        "-k",
        "--insecure",
        "-O",
        "--remote-name",
      ],
      [
        "--max-time",
        "-m",
        "--connect-timeout",
        "--noproxy",
        "--proxy",
        "-x",
        "-H",
        "--header",
        "-A",
        "--user-agent",
        "-X",
        "--request",
        "-o",
        "--output",
      ],
    );
    if (!parsed?.targets.length) return null;
    const method = parsed.value("-X", "--request"),
      output = parsed.value("-o", "--output");
    if (method && !["GET", "HEAD"].includes(method)) return null;
    const urls = parsed.targets.join("、");
    const head = parsed.has("-I", "--head") || method === "HEAD";
    if (
      parsed.allValues("-o", "--output").length > 1 ||
      (output && parsed.targets.length > 1)
    )
      return null;
    if (output || parsed.has("-O", "--remote-name"))
      return `${head ? "保存响应头" : "下载"} ${urls}${output ? " 到 " + output : ""}`;
    return `${head ? "查看响应头" : "请求地址"} ${urls}`;
  }
  return null;
}

export function operationDescription(name, args, depth = 0) {
  if (depth > 3) return null;
  if (
    args.length === 1 &&
    (args[0] === "--version" ||
      (args[0] === "-V" &&
        ["python", "python3", "uv", "curl"].includes(name)) ||
      (args[0] === "-v" && ["node", "npm", "npx"].includes(name))) &&
    ["git", "npm", "npx", "node", "python", "python3", "uv", "curl"].includes(
      name,
    )
  )
    return `查看 ${name} 版本`;
  if (name === "git") return gitDescription(args);
  if (name === "npm") return npmDescription(args);
  if (name === "npx") {
    const rest = ["--yes", "-y"].includes(args[0]) ? args.slice(1) : args;
    if (rest[0] !== "prettier") return null;
    const parsed = options(
      rest.slice(1),
      [
        "--check",
        "--write",
        "--list-different",
        "--ignore-unknown",
        "--no-error-on-unmatched-pattern",
      ],
      ["--config", "--ignore-path", "--parser"],
    );
    if (!parsed) return null;
    return (
      (parsed.has("--write")
        ? "格式化文件"
        : parsed.has("--check")
          ? "检查代码格式"
          : parsed.has("--list-different")
            ? "列出格式不同的文件"
            : "预览代码格式化结果") + scope(parsed.targets)
    );
  }
  if (name === "node" && args[0] === "--test") {
    const parsed = options(
      args.slice(1),
      [],
      ["--test-concurrency", "--test-name-pattern", "--test-reporter"],
    );
    return parsed ? "运行 Node.js 测试" + scope(parsed.targets) : null;
  }
  if (["python", "python3", "node"].includes(name)) {
    const language = name === "node" ? "Node.js" : "Python";
    if (
      ["-c", "-e", "--eval"].includes(args[0]) &&
      args[1] !== undefined &&
      (name === "node" ? args[0] !== "-c" : args[0] === "-c")
    )
      return `执行 ${language} 代码`;
    if (name !== "node" && args[0] === "-m") {
      if (args[1] === "pytest")
        return "运行 Python 测试" + scope(args.slice(2), "参数");
      if (args[1] === "py_compile" && args.length > 2)
        return "检查 Python 语法" + scope(args.slice(2));
      if (args[1])
        return `运行 Python 模块 ${args[1]}` + scope(args.slice(2), "参数");
    }
    if (args[0] && !args[0].startsWith("-"))
      return `运行 ${language} 脚本 ${args[0]}` + scope(args.slice(1), "参数");
  }
  if (name === "uv" && args[0] === "run") {
    let index = 1;
    const context = [];
    while (index < args.length) {
      const arg = args[index];
      if (
        [
          "--offline",
          "--no-project",
          "--frozen",
          "--locked",
          "--no-sync",
          "--quiet",
        ].includes(arg)
      )
        index++;
      else if (
        ["--project", "--directory", "--python", "--with"].includes(arg) &&
        args[index + 1]
      ) {
        context.push(`${arg.slice(2)}：${args[index + 1]}`);
        index += 2;
      } else if (arg === "--") {
        index++;
        break;
      } else if (arg.startsWith("-")) return null;
      else break;
    }
    const executable = args[index];
    if (!executable) return null;
    const nested = operationDescription(
      executable,
      args.slice(index + 1),
      depth + 1,
    );
    return (
      `通过 uv ${nested || "运行 " + executable + scope(args.slice(index + 1), "参数")}` +
      scope(context, "环境")
    );
  }
  return queryDescription(name, args);
}
