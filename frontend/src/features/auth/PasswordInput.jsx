import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '../../components/ui/Form.jsx';

/** Password field with a show/hide toggle (reduces typos, especially on phones). */
export const PasswordInput = forwardRef(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className="pr-10" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-ink-subtle hover:text-ink sm:h-7 sm:w-7"
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
});

const RULES = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'A letter', test: (v) => /[A-Za-z]/.test(v) },
  { label: 'A number', test: (v) => /\d/.test(v) },
];

/** Live checklist for the shared password policy (same rules the server enforces). */
export function PasswordChecklist({ value = '', id }) {
  return (
    <ul id={id} className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="Password requirements">
      {RULES.map((r) => {
        const met = r.test(value);
        return (
          <li key={r.label} className={met ? 'text-success-600' : 'text-ink-subtle'}>
            <span aria-hidden="true">{met ? '✓' : '○'}</span> {r.label}
            <span className="sr-only">{met ? ' (met)' : ' (not yet)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
