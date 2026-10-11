import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useCreateProject, useUpdateProject } from './api.js';
import { useMemberOptions } from '../team/api.js';
import { MemberPicker } from '../team/MemberPicker.jsx';
import { useAssignableBranches, useHasSeveralBranches } from '../branches/api.js';
import { ConfirmDialog, Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Input, Select, Textarea } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PlanLimitNotice } from '../../components/feedback/States.jsx';
import { PRIORITY, PROJECT_STATUS } from '../../lib/status.js';
import { applyServerErrors, emptyToNull } from '../../lib/forms.js';
import { isPlanLimitError } from '../../lib/api.js';
import { toDateInput } from '../../lib/format.js';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Project name is too short').max(100),
    description: z.string().max(2000).optional(),
    status: z.string(),
    priority: z.string(),
    startDate: z.string().optional(),
    dueDate: z.string().optional(),
    leadId: z.string().optional(),
    branchId: z.string().optional(),
    memberIds: z.array(z.string()).optional(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, { path: ['dueDate'], message: 'Due date cannot be before the start date' });

/** Create (with team) or edit a project. Team changes after creation happen in the project's Team tab. */
export function ProjectFormModal({ open, onOpenChange, project, onCreated }) {
  const editing = !!project;
  const create = useCreateProject();
  const update = useUpdateProject(project?.id);
  const members = useMemberOptions();
  // Branch choice only matters once the company has more than one branch.
  const severalBranches = useHasSeveralBranches();
  const { branches } = useAssignableBranches();
  const branchOptions = project?.branch && !branches.some((b) => b.id === project.branch.id) ? [project.branch, ...branches] : branches;
  const showBranch = severalBranches && (branchOptions.length > 0 || !!project?.branch);
  const [error, setError] = useState(null);
  // D-4: completing with unfinished tasks asks for an explicit confirmation (the server records it).
  const [openTasksPrompt, setOpenTasksPrompt] = useState(null);

  const form = useForm({
    resolver: zodResolver(schema),
    values: open
      ? {
          name: project?.name ?? '',
          description: project?.description ?? '',
          status: project?.status ?? 'PLANNING',
          priority: project?.priority ?? 'MEDIUM',
          startDate: toDateInput(project?.startDate),
          dueDate: toDateInput(project?.dueDate),
          leadId: project?.lead?.id ?? '',
          branchId: project?.branch?.id ?? '',
          memberIds: [],
        }
      : undefined,
  });
  const { register, handleSubmit, formState, control } = form;

  const close = (next) => {
    if (!next) setError(null);
    onOpenChange(next);
  };

  const onSubmit = (v) => {
    setError(null);
    const body = {
      name: v.name,
      description: emptyToNull(v.description),
      status: v.status,
      priority: v.priority,
      startDate: emptyToNull(v.startDate),
      dueDate: emptyToNull(v.dueDate),
      leadId: emptyToNull(v.leadId),
      ...(showBranch && { branchId: emptyToNull(v.branchId) }),
      ...(!editing && { memberIds: v.memberIds }),
    };
    if (editing) {
      // Send only what changed, so the activity log records exactly what happened.
      const original = {
        name: project.name,
        description: project.description ?? null,
        status: project.status,
        priority: project.priority,
        startDate: toDateInput(project.startDate) || null,
        dueDate: toDateInput(project.dueDate) || null,
        leadId: project.lead?.id ?? null,
        branchId: project.branch?.id ?? null,
      };
      for (const key of Object.keys(body)) if (body[key] === original[key]) delete body[key];
      if (!Object.keys(body).length) return close(false);
    }
    save(body);
  };

  const save = (body) => {
    const mutation = editing ? update : create;
    mutation.mutate(body, {
      onSuccess: (saved) => {
        setOpenTasksPrompt(null);
        toast.success(editing ? 'Project updated' : 'Project created');
        close(false);
        onCreated?.(saved);
      },
      onError: (err) => {
        if (err.code === 'PROJECT_HAS_OPEN_TASKS') return setOpenTasksPrompt({ body, count: Number(err.details?.[0]?.message) || null });
        setOpenTasksPrompt(null);
        if (!applyServerErrors(form, err)) setError(err);
      },
    });
  };

  const pending = create.isPending || update.isPending;

  return (
    <Modal open={open} onOpenChange={close} title={editing ? 'Edit project' : 'New project'} description={editing ? undefined : 'Projects group related tasks and the people working on them.'}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          {error && (isPlanLimitError(error) ? <PlanLimitNotice code={error.code} message={error.message} /> : <FormAlert>{error.message}</FormAlert>)}
          <Field label="Project name" required error={formState.errors.name?.message}>
            <Input autoFocus placeholder="e.g. Website Redesign" {...register('name')} />
          </Field>
          <Field label="Description" optional>
            <Textarea rows={2} placeholder="What is this project about?" {...register('description')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select {...register('status')}>
                {Object.entries(PROJECT_STATUS).map(([v, s]) => (
                  <option key={v} value={v}>{s.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select {...register('priority')}>
                {Object.entries(PRIORITY).map(([v, p]) => (
                  <option key={v} value={v}>{p.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Start date" optional>
              <Input type="date" {...register('startDate')} />
            </Field>
            <Field label="Due date" optional error={formState.errors.dueDate?.message}>
              <Input type="date" {...register('dueDate')} />
            </Field>
          </div>
          <Field label="Responsible person" hint="The lead is accountable for the project and joins its team." error={formState.errors.leadId?.message}>
            <Select {...register('leadId')}>
              <option value="">No lead yet</option>
              {members.data?.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.jobTitle ? ` — ${m.jobTitle}` : ''}</option>
              ))}
            </Select>
          </Field>
          {showBranch && (
            <Field label="Branch" hint="Organization-wide projects follow normal role and team rules; branch projects are seen by that branch's people." error={formState.errors.branchId?.message}>
              <Select {...register('branchId')}>
                <option value="">Organization-wide</option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
          )}
          {!editing && (
            <div>
              <p className="mb-1 text-[13px] font-medium">
                Team <span className="font-normal text-ink-subtle">(optional)</span>
              </p>
              <Controller control={control} name="memberIds" render={({ field }) => <MemberPicker value={field.value} onChange={field.onChange} label="Team members" maxHeight="max-h-40" />} />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" variant="primary" loading={pending}>
            {editing ? 'Save changes' : 'Create project'}
          </Button>
        </DialogFooter>
      </form>
      <ConfirmDialog
        open={!!openTasksPrompt}
        onOpenChange={(o) => !o && setOpenTasksPrompt(null)}
        title="Complete with unfinished tasks?"
        description={`This project still has ${openTasksPrompt?.count ?? 'some'} unfinished task(s). Completing it leaves them exactly as they are — nothing is completed or deleted — and the history records that you chose to complete it anyway.`}
        confirmLabel="Complete anyway"
        tone="primary"
        loading={update.isPending}
        onConfirm={() => save({ ...openTasksPrompt.body, confirmOpenTasks: true })}
      />
    </Modal>
  );
}
