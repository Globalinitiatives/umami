'use client';
import {
  Button,
  Form,
  FormButtons,
  FormField,
  FormSubmitButton,
  Radio,
  RadioGroup,
  Text,
  TextField,
} from '@umami/react-zen';
import { useState } from 'react';
import { useApi, useConfig, useMessages } from '@/components/hooks';
import { touch } from '@/components/hooks/useModified';

const DURATIONS = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

export function ReplayShareForm({
  websiteId,
  replayId,
  onClose,
}: {
  websiteId: string;
  replayId: string;
  onClose?: () => void;
}) {
  const { t, labels, messages } = useMessages();
  const { cloudMode } = useConfig();
  const { post, useMutation } = useApi();
  const [url, setUrl] = useState<string>(null);

  const { mutateAsync, error, isPending } = useMutation({
    mutationFn: (payload: { note: string; duration: string }) =>
      post(`/websites/${websiteId}/replays/shared`, {
        visitId: replayId,
        ...payload,
      }),
  });

  const getUrl = (slug: string) =>
    `${cloudMode ? process.env.cloudUrl : window?.location.origin}${process.env.basePath || ''}/share/replay/${slug}`;

  const handleSubmit = async (formData: { note: string; duration: string }) => {
    const result = await mutateAsync({
      note: formData.note,
      duration: formData.duration,
    });

    setUrl(getUrl(result.slug));
    touch('replays');
  };

  if (url) {
    return (
      <Form>
        <FormField name="link" label={t(labels.replayLink)}>
          <TextField value={url} isReadOnly allowCopy autoFocus />
        </FormField>
        <Text color="muted" size="sm">
          {t(`message.${messages.replayShared}`)}
        </Text>
        <FormButtons>
          <Button onPress={onClose}>{t(labels.close)}</Button>
        </FormButtons>
      </Form>
    );
  }

  return (
    <Form onSubmit={handleSubmit} error={error?.message}>
      <FormField name="note" label={t(labels.note)}>
        <TextField autoFocus />
      </FormField>
      <FormField name="duration" label={t(labels.expires)}>
        <RadioGroup defaultValue="24h">
          {DURATIONS.map(({ value, label }) => (
            <Radio key={value} value={value}>
              {label}
            </Radio>
          ))}
        </RadioGroup>
      </FormField>
      <FormButtons>
        <Button isDisabled={isPending} onPress={onClose}>
          {t(labels.cancel)}
        </Button>
        <FormSubmitButton variant="primary" isDisabled={isPending}>
          {t(labels.shareReplay)}
        </FormSubmitButton>
      </FormButtons>
    </Form>
  );
}
