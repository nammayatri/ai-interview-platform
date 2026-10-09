"use client";

import { useState } from "react";
import Editor from "@monaco-editor/react";

const LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
];

const DEFAULT_CODE: Record<string, string> = {
  javascript: '// Write your solution here\nfunction solve(input) {\n  \n}\n',
  python: '# Write your solution here\ndef solve(input):\n    pass\n',
  java: '// Write your solution here\nclass Solution {\n    public static void main(String[] args) {\n        \n    }\n}\n',
  cpp: '// Write your solution here\n#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  go: '// Write your solution here\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}\n',
  rust: '// Write your solution here\nfn main() {\n    \n}\n',
};

interface CodeEditorProps {
  language: string;
  onCodeChange?: (code: string) => void;
  initialCode?: string;
  /** Display-only: no toolbar, no run button, no editing (used to show a candidate's submitted code). */
  readOnly?: boolean;
  /** Called once Monaco has mounted (lets the caller fall back to plain text when the CDN is blocked). */
  onReady?: () => void;
}

// Monaco language ids for the names interviewers type into the submission form.
const MONACO_LANG: Record<string, string> = {
  "c++": "cpp", cpp: "cpp", "c#": "csharp", csharp: "csharp", js: "javascript", javascript: "javascript",
  ts: "typescript", typescript: "typescript", python: "python", python3: "python", java: "java", go: "go", golang: "go",
  rust: "rust", kotlin: "kotlin", swift: "swift", ruby: "ruby", scala: "scala", php: "php", sql: "sql",
};

export default function CodeEditor({ language: initialLang, onCodeChange = () => {}, initialCode, readOnly = false, onReady }: CodeEditorProps) {
  if (readOnly) {
    return (
      <div className="h-full min-h-[160px] overflow-hidden rounded-lg border border-white/10 bg-[#1e1e1e]">
        <Editor
          height="100%"
          language={MONACO_LANG[(initialLang || "").toLowerCase()] || "plaintext"}
          value={initialCode || ""}
          theme="vs-dark"
          onMount={() => onReady?.()}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            contextmenu: false,
            renderLineHighlight: "none",
            padding: { top: 8 },
          }}
        />
      </div>
    );
  }
  return <EditableCodeEditor language={initialLang} onCodeChange={onCodeChange} initialCode={initialCode} />;
}

function EditableCodeEditor({ language: initialLang, onCodeChange, initialCode }: { language: string; onCodeChange: (code: string) => void; initialCode?: string }) {
  const [language, setLanguage] = useState(initialLang || "javascript");
  const [code, setCode] = useState(initialCode || DEFAULT_CODE[initialLang] || DEFAULT_CODE.javascript);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    const newCode = DEFAULT_CODE[newLang] || "";
    setCode(newCode);
    onCodeChange(newCode);
  };

  const handleCodeChange = (value: string | undefined) => {
    const newCode = value || "";
    setCode(newCode);
    onCodeChange(newCode);
  };

  const handleRun = () => {
    setRunning(true);
    setOutput("Running...\n");
    setTimeout(() => {
      setOutput(`[Simulated Output]\n\nCode compiled and executed successfully.\nLanguage: ${language}\nLines: ${code.split("\n").length}\n\nNote: Actual code execution is handled during submission review.`);
      setRunning(false);
    }, 1200);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-sm text-white outline-none focus:border-blue-500/50 transition-colors appearance-none cursor-pointer"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value} className="bg-[#1e1e2e]">
                {lang.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            {code.split("\n").length} lines
          </span>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
            bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/20
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {running ? "Running..." : "Run"}
        </button>
      </div>

      {/* Editor */}
      <div className="h-[400px]">
        <Editor
          height="100%"
          language={language}
          value={code}
          onChange={handleCodeChange}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "on",
            roundedSelection: true,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: "on",
            padding: { top: 12 },
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
          }}
        />
      </div>

      {/* Output */}
      {output && (
        <div className="border-t border-white/10">
          <div className="flex items-center justify-between px-4 py-1.5 bg-white/[0.02]">
            <span className="text-xs text-zinc-500 font-medium">Output</span>
            <button
              onClick={() => setOutput("")}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition"
            >
              Clear
            </button>
          </div>
          <pre className="px-4 py-3 text-sm text-zinc-300 font-mono max-h-[150px] overflow-auto bg-black/30">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
