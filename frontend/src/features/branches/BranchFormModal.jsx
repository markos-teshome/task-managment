import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useCreateBranch, useUpdateBranch } from './api.js';
import { MemberPicker } from '../team/MemberPicker.jsx';
import { Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Input, Textarea } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PlanLimitNotice } from '../../components/feedback/States.jsx';
import { applyServerErrors, emptyToNull } from '../../lib/forms.js';
import { isPlanLimitError } from '../../lib/api.js';

// Mirrors the API's rules; the server validates again.
const schema = z.object({
  name: z.string().trim().min(2, 'Branch name is too short').max(80),
  code: z
    .string()
    .trim()
    .regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,19})?$/, 'Up to 20 letters, digits, - or _')
    .optional(),
  description: z.string().max(500).optional(),
  address: z.string().max(300).optional(),
  managerId: z.string().nullable().optional(),
});

/** Create a branch, or edit one (owners/admins: everything; a branch manager: description and address only). */
export function BranchFormModal({ open, onOpenChange, branch, managerOnly = false, onCreated }) {
  const editing = !!branch;
  const create = useCreateBranch();
  const update = useUpdateBranch(branch?.id);
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(schema),
    values: open
      ? { name: branch?.name ?? '', code: branch?.code ?? '', description: branch?.description ?? '', address: branch?.address ?? '', managerId: branch?.manager?.id ?? null }
      : undefined,
  });

  const close = (next) => {
    if (!next) setError(null);
    onOpenChange(next);
  };

  const onSubmit = (values) => {
    setError(null);
    const body = managerOnly
      ? { description: emptyToNull(values.description), address: emptyToNull(values.address) }
      : {
          name: values.name,
          code: emptyToNull(values.code),
          description: emptyToNull(values.description),
          address: emptyToNull(values.address),
          managerId: values.managerId ?? null,
        };
    (editing ? update : create).mutate(body, {
      onSuccess: (saved) => {
        toast.success(editing ? 'Branch updated' : `${saved.name} created`);
        close(false);
        if (!editing) onCreated?.(saved);
      },
      onError: (err) => !applyServerErrors(form, err) && setError(err),
    });
  };

  const pending = create.isPending || update.isPending;
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={editing ? `Edit ${branch.name}` : 'Add a branch'}
      description={editing ? undefined : 'A location or team of your company. Branches share your plan and members.'}
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          {error && isPlanLimitError(error) ? <PlanLimitNotice code={error.code} message={error.message} /> : <FormAlert>{error?.message}</FormAlert>}
          {!managerOnly && (
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <Field label="Branch name" required error={form.formState.errors.name?.message}>
                <Input autoFocus placeholder="e.g. Bole Branch" {...form.register('name')} />
              </Field>
              <Field label="Code" optional error={form.formState.errors.code?.message}>
                <Input placeholder="BOLE" className="uppercase" {...form.register('code')} />
              </Field>
            </div>
          )}
          <Field label="Address" optional error={form.formState.errors.address?.message}>
            <Input placeholder="e.g. Bole Road, Addis Ababa" {...form.register('address')} />
          </Field>
          <Field label="Description" optional error={form.formState.errors.description?.message}>
            <Textarea rows={2} {...form.register('description')} />
          </Field>
          {!managerOnly && (
            <Field label="Branch manager" optional hint="Must be a member of your organization. They join the branch automatically." error={form.formState.errors.managerId?.message}>
              <Controller
                control={form.control}
                name="managerId"
                render={({ field }) => <MemberPicker single label="Branch manager" value={field.value} onChange={field.onChange} maxHeight="max-h-40" />}
              />
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button type="submit" variant="primary" loading={pending}>
            {editing ? 'Save changes' : 'Create branch'}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
