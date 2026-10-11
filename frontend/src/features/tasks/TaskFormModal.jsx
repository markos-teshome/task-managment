import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useCreateTask } from './api.js';
import { useProject, useProjects } from '../projects/api.js';
import { Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Input, Select, Textarea } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PRIORITY, TASK_STATUS } from '../../lib/status.js';
import { applyServerErrors, emptyToNull } from '../../lib/forms.js';

const schema = z.object({
  projectId: z.string().min(1, 'Choose a project'),
  title: z.string().trim().min(2, 'Give the task a short title').max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
});

/** Create a task. With `projectId` the project is fixed (opened from a project page). */
export function TaskFormModal({ open, onOpenChange, projectId, defaultAssigneeId }) {
  const { can } = useAuth();
  const canAssign = can('TASK_ASSIGN');
  const projects = useProjects({ pageSize: 100, sort: 'name', order: 'asc' }, { enabled: open && !projectId });
  // D-3: tasks go into projects the person manages or is on.
  const choosable = (projects.data?.items ?? []).filter((p) => p.inScope);
  const create = useCreateTask();
  const [error, setError] = useState(null);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { projectId: projectId ?? '', title: '', description: '', status: 'TODO', priority: 'MEDIUM', assigneeId: defaultAssigneeId ?? '', dueDate: '' },
  });
  const { register, handleSubmit, formState, reset, watch } = form;
  // D-12: only the chosen project's team can be assigned.
  const chosenProjectId = projectId ?? watch('projectId');
  const project = useProject(open && canAssign && chosenProjectId ? chosenProjectId : null);
  const team = (project.data?.members ?? []).filter((m) => m.status === 'ACTIVE');

  const close = (next) => {
    if (!next) {
      reset();
      setError(null);
    }
    onOpenChange(next);
  };

  const onSubmit = (values) => {
    setError(null);
    create.mutate(
      {
        ...values,
        description: emptyToNull(values.description),
        assigneeId: canAssign ? emptyToNull(values.assigneeId) : undefined,
        dueDate: emptyToNull(values.dueDate),
      },
      {
        onSuccess: () => {
          toast.success('Task created');
          close(false);
        },
        onError: (err) => !applyServerErrors(form, err) && setError(err.message),
      },
    );
  };

  return (
    <Modal open={open} onOpenChange={close} title="New task">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          <FormAlert>{error}</FormAlert>
          {!projectId && (
            <Field label="Project" required error={formState.errors.projectId?.message}>
              <Select {...register('projectId')} disabled={projects.isLoading}>
                <option value="">{projects.isLoading ? 'Loading projects…' : 'Select a project'}</option>
                {choosable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Title" required error={formState.errors.title?.message}>
            <Input autoFocus placeholder="e.g. Design homepage" {...register('title')} />
          </Field>
          <Field label="Description" optional>
            <Textarea rows={3} placeholder="Add details, links or acceptance criteria" {...register('description')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select {...register('status')}>
                {Object.entries(TASK_STATUS).map(([v, s]) => (
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
            {canAssign && (
              <Field label="Assignee" hint="Only the project team can be assigned. Add people in the project's Team tab." error={formState.errors.assigneeId?.message}>
                <Select {...register('assigneeId')} disabled={!chosenProjectId}>
                  <option value="">{chosenProjectId ? 'Unassigned' : 'Choose a project first'}</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Due date" error={formState.errors.dueDate?.message}>
              <Input type="date" {...register('dueDate')} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create task
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
