import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { api } from '../../lib/api.js';
import { applyServerErrors, rules } from '../../lib/forms.js';

/**
 * A signed-in person creates another organization: they become its Owner, it starts on the Free plan
 * and becomes the active workspace. Joining an existing organization is only possible by invitation.
 */
export function CreateOrganizationDialog({ open, onOpenChange }) {
  const { applySession } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(z.object({ name: rules.organizationName })), values: open ? { name: '' } : undefined });

  const onSubmit = async ({ name }) => {
    setError(null);
    try {
      const session = await api.post('/organizations', { name });
      onOpenChange(false);
      applySession(session);
      navigate('/', { replace: true });
      toast.success(`${session.me.workspace.organization.name} is ready. You're its owner.`);
    } catch (err) {
      if (err.code === 'ORGANIZATION_NAME_IN_USE') form.setError('name', { message: err.message });
      else if (!applyServerErrors(form, err)) setError(err.message);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm" title="Create an organization" description="You'll be its owner. It starts on the Free plan.">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-3">
          <FormAlert>{error}</FormAlert>
          <Field label="Organization name" hint="Its official name, as your team knows it." error={form.formState.errors.name?.message}>
            <Input autoFocus autoComplete="organization" placeholder="e.g. Abay Trading PLC" {...form.register('name')} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            Create organization
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
