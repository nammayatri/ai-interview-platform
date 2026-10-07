"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmModal } from "@/components/ConfirmModal";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export default function TeamPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{id: string; name: string} | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "member", password: "" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const isAdmin = (session?.user as any)?.role === "admin";

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint32Array(12));
    setForm((f) => ({ ...f, password: Array.from(bytes, (b) => chars[b % chars.length]).join("") }));
  };

  const openAdd = () => {
    setForm({ name: "", email: "", role: "member", password: "" });
    setAddError("");
    setCreated(null);
    setCopied(false);
    setShowAdd(true);
  };

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    setAdding(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data.error || "Failed to add member");
        return;
      }
      setCreated({ email: data.email, password: form.password });
      fetchUsers();
    } catch {
      setAddError("Failed to add member");
    } finally {
      setAdding(false);
    }
  };

  const copyCredentials = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`);
      setCopied(true);
    } catch {}
  };

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const toggleActive = async (userId: string, currentActive: boolean) => {
    await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    fetchUsers();
  };

  const toggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === "admin" ? "member" : "admin";
    await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    fetchUsers();
  };

  const deleteUser = async (userId: string) => {
    const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete user");
      return;
    }
    fetchUsers();
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8 animate-fade-in-down">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Team</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage team members and access
              {!isAdmin && " (admin access required to make changes)"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={openAdd} className="btn-primary !py-2 !px-4 text-sm mr-3">
                + Add member
              </button>
            )}
            <span className="text-xs text-gray-500">{users.length} member{users.length !== 1 ? "s" : ""}</span>
            <span className="text-xs text-gray-300">|</span>
            <span className="text-xs text-green-600">{users.filter(u => u.is_active).length} active</span>
            <span className="text-xs text-amber-600">{users.filter(u => !u.is_active).length} pending</span>
          </div>
        </div>

        {loading ? (
          <div className="card p-6 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="skeleton w-10 h-10 rounded-full" />
                <div className="flex-1"><div className="skeleton h-4 w-40 mb-2" /><div className="skeleton h-3 w-60" /></div>
                <div className="skeleton h-8 w-20 rounded-lg" />
              </div>
            ))}
          </div>
        ) : (
          <div className="card overflow-hidden animate-fade-in-up">
            {users.length === 0 ? (
              <div className="p-16 text-center">
                <svg className="w-28 h-28 mx-auto mb-6 text-gray-200" viewBox="0 0 120 120" fill="none">
                  <circle cx="40" cy="45" r="14" stroke="currentColor" strokeWidth="2" />
                  <circle cx="40" cy="39" r="5" fill="currentColor" opacity="0.3" />
                  <path d="M28 58a12 12 0 0124 0" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3" />
                  <circle cx="75" cy="45" r="14" stroke="currentColor" strokeWidth="2" />
                  <circle cx="75" cy="39" r="5" fill="currentColor" opacity="0.3" />
                  <path d="M63 58a12 12 0 0124 0" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3" />
                  <circle cx="95" cy="75" r="12" fill="#818cf8" opacity="0.15" stroke="#818cf8" strokeWidth="2" />
                  <path d="M92 75h6M95 72v6" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
                </svg>
                <p className="text-xl font-semibold text-gray-900 mb-2">No team members yet</p>
                <p className="text-gray-500 max-w-sm mx-auto">Use &quot;Add member&quot; to create an account, or members appear here once they register.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                      user.is_active
                        ? "bg-indigo-100 text-indigo-600"
                        : "bg-gray-100 text-gray-400"
                    }`}>
                      {user.name.charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          user.role === "admin" ? "bg-purple-50 text-purple-600" : "bg-gray-50 text-gray-500"
                        }`}>
                          {user.role}
                        </span>
                        {!user.is_active && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
                            pending activation
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                    </div>

                    {/* Joined date */}
                    <span className="text-xs text-gray-400 hidden sm:block">
                      {new Date(user.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>

                    {/* Actions */}
                    {isAdmin && user.id !== (session?.user as any)?.id && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleActive(user.id, user.is_active)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                            user.is_active
                              ? "text-amber-600 border-amber-200 hover:bg-amber-50"
                              : "text-green-600 border-green-200 hover:bg-green-50"
                          }`}
                        >
                          {user.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => toggleRole(user.id, user.role)}
                          className="text-xs text-purple-600 border border-purple-200 hover:bg-purple-50 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {user.role === "admin" ? "Remove Admin" : "Make Admin"}
                        </button>
                        <button
                          onClick={() => setDeleteTarget({id: user.id, name: user.name})}
                          className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}

                    {/* Self indicator */}
                    {user.id === (session?.user as any)?.id && (
                      <span className="text-[10px] text-indigo-500 font-medium">You</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !adding && setShowAdd(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            {created ? (
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Member added</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Share these credentials with them securely. The password is shown only now and can&apos;t be retrieved later.
                </p>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 font-mono text-sm text-gray-800 space-y-1 break-all">
                  <div><span className="text-gray-400">Email:</span> {created.email}</div>
                  <div><span className="text-gray-400">Password:</span> {created.password}</div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button onClick={copyCredentials} className="btn-secondary !py-2 !px-4 text-sm">
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button onClick={() => setShowAdd(false)} className="btn-primary !py-2 !px-4 text-sm">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={addMember} className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Add team member</h2>
                <p className="text-sm text-gray-500 mb-4">The account is active immediately — no registration or approval needed.</p>

                <label className="block text-xs font-medium text-gray-600 mb-1">Full name</label>
                <input
                  className="input-field !py-2.5 mb-3"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Doe"
                  required
                  autoFocus
                />

                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  className="input-field !py-2.5 mb-3"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@nammayatri.in"
                  required
                />

                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select
                  className="input-field !py-2.5 mb-3"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>

                <label className="block text-xs font-medium text-gray-600 mb-1">Temporary password</label>
                <div className="flex gap-2 mb-1">
                  <input
                    className="input-field !py-2.5 font-mono"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                  />
                  <button type="button" onClick={generatePassword} className="btn-secondary !py-2 !px-3 text-sm whitespace-nowrap">
                    Generate
                  </button>
                </div>

                {addError && <p className="text-sm text-red-600 mt-3">{addError}</p>}

                <div className="flex justify-end gap-2 mt-5">
                  <button type="button" onClick={() => setShowAdd(false)} disabled={adding} className="btn-secondary !py-2 !px-4 text-sm">
                    Cancel
                  </button>
                  <button type="submit" disabled={adding} className="btn-primary !py-2 !px-4 text-sm disabled:opacity-40">
                    {adding ? "Adding..." : "Add member"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Team Member"
        message={`Are you sure you want to remove ${deleteTarget?.name ?? ""} from the team?`}
        onConfirm={() => {
          if (deleteTarget) deleteUser(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </DashboardLayout>
  );
}
