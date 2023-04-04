import { TeamSettingsLayout } from '@/components/layouts/TeamSettingsLayout';
import Button from '@/components/ui/Button';
import { ErrorLabel } from '@/components/ui/Forms';
import { NoAutoInput } from '@/components/ui/Input';
import {
  CTABar,
  DescriptionLabel,
  SettingsCard,
} from '@/components/ui/SettingsCard';
import useTeam from '@/lib/hooks/use-team';
import {
  ErrorMessage,
  Field,
  Form,
  Formik,
  FormikErrors,
  FormikValues,
} from 'formik';
import Router, { useRouter } from 'next/router';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import ConfirmDialog from '@/components/dialogs/Confirm';
import useTeams from '@/lib/hooks/use-teams';
import { toast } from 'react-hot-toast';
import {
  cancelSubscription,
  deleteTeamAndMemberships,
  deleteUserAndMembershipsAndTeams,
  isTeamSlugAvailable,
  updateTeam,
} from '@/lib/api';
import useUser from '@/lib/hooks/use-user';
import { GitHubIcon } from '@/components/icons/GitHub';
import useOAuth from '@/lib/hooks/utils/use-oauth';
import { setGitHubAuthState } from '@/lib/supabase';
import { createBrowserSupabaseClient } from '@supabase/auth-helpers-nextjs';
import { getAppInstallations } from '@/lib/github';

const TeamSettingsPage = () => {
  const router = useRouter();
  const { user, mutate: mutateUser, signOut } = useUser();
  const { teams, mutate: mutateTeams } = useTeams();
  const { team, mutate: mutateTeam } = useTeam();
  const { showAuthPopup, disconnect, getTokenData, getTokenState } = useOAuth();
  const [loading, setLoading] = useState(false);
  const [confirmDisconnectGitHubOpen, setConfirmDisconnectGitHubOpen] =
    useState(false);
  const [supabase] = useState(() => createBrowserSupabaseClient());

  if (!teams || !team || !user) {
    return <TeamSettingsLayout title="Settings" width="sm" />;
  }

  const githubToken = getTokenData('github');
  const githubTokenState = getTokenState('github');

  return (
    <TeamSettingsLayout title="Settings" width="sm">
      <div className="flex flex-col gap-8">
        <SettingsCard title="General">
          <Formik
            initialValues={{
              name: team.name,
              slug: team.slug,
            }}
            validateOnMount
            validate={async (values) => {
              let errors: FormikErrors<FormikValues> = {};
              if (!values.name) {
                errors.name = 'Required';
              } else if (!values.slug) {
                errors.slug = 'Required';
              } else {
                if (values.slug !== team.slug) {
                  const isAvailable = await isTeamSlugAvailable(values.slug);
                  if (!isAvailable) {
                    errors.slug = 'Slug is not available';
                  }
                }
              }
              return errors;
            }}
            onSubmit={async (values, { setSubmitting }) => {
              const updatedTeam = { ...team, ...values };
              await mutateTeam(updateTeam(team.id, values), {
                optimisticData: updatedTeam,
                rollbackOnError: true,
                populateCache: true,
                revalidate: false,
              });
              await mutateTeams([
                ...teams.filter((p) => p.id !== updatedTeam.id),
                updatedTeam,
              ]);
              setSubmitting(false);
              toast.success('Project settings saved.');
              if (router.query.team !== values.slug) {
                setTimeout(() => {
                  router.replace({
                    pathname: '/settings/[team]',
                    query: { team: values.slug },
                  });
                }, 500);
              }
            }}
          >
            {({ isSubmitting, isValid }) => (
              <Form>
                <div className="flex flex-col gap-1 p-4">
                  <p className="mb-1 text-xs font-medium text-neutral-300">
                    Name
                  </p>
                  <Field
                    type="text"
                    name="name"
                    inputSize="sm"
                    as={NoAutoInput}
                    disabled={isSubmitting}
                  />
                  <ErrorMessage name="name" component={ErrorLabel} />
                  <p className="mb-1 mt-4 text-xs font-medium text-neutral-300">
                    Slug
                  </p>
                  <Field
                    type="text"
                    name="slug"
                    inputSize="sm"
                    as={NoAutoInput}
                    disabled={isSubmitting}
                  />
                  <ErrorMessage name="slug" component={ErrorLabel} />
                </div>
                <CTABar>
                  <Button
                    disabled={!isValid}
                    loading={isSubmitting}
                    variant="plain"
                    buttonSize="sm"
                    type="submit"
                  >
                    Save
                  </Button>
                </CTABar>
              </Form>
            )}
          </Formik>
        </SettingsCard>
        {team.is_personal && (
          <SettingsCard title="Connected accounts">
            <DescriptionLabel>
              {githubTokenState === 'no_token' ? (
                'Connect your GitHub account to sync private repositories.'
              ) : (
                <>
                  Connected as{' '}
                  <GitHubIcon className="ml-1 mr-1 inline-block h-3 w-3" />
                  <a
                    href={`https://github.com/${
                      (githubToken?.meta as any)?.login
                    }`}
                    className="subtle-underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {(githubToken?.meta as any)?.login || 'Unknown'}
                  </a>
                  .
                </>
              )}
            </DescriptionLabel>
            <CTABar>
              {(githubTokenState === 'no_token' ||
                githubTokenState === 'expired') && (
                <Button
                  variant="plain"
                  buttonSize="sm"
                  Icon={
                    githubTokenState === 'no_token' ? GitHubIcon : undefined
                  }
                  onClick={async () => {
                    const state = await setGitHubAuthState(supabase, user.id);
                    const authed = await showAuthPopup('github', state);
                    if (authed) {
                      toast.success('Authorization has been granted.');
                    }
                  }}
                >
                  {githubTokenState === 'no_token'
                    ? 'Authorize GitHub'
                    : 'Re-authorize'}
                </Button>
              )}
              {(githubTokenState === 'expired' ||
                githubTokenState === 'valid') && (
                <Button
                  variant="plain"
                  buttonSize="sm"
                  onClick={async () => {
                    setConfirmDisconnectGitHubOpen(true);
                  }}
                >
                  Disconnect
                </Button>
              )}
            </CTABar>
          </SettingsCard>
        )}
        <SettingsCard
          title={team.is_personal ? 'Delete account' : 'Delete team'}
        >
          <DescriptionLabel>
            All projects and associated data will be deleted.
          </DescriptionLabel>
          <CTABar>
            <Dialog.Root>
              <Dialog.Trigger asChild>
                <Button variant="danger" buttonSize="sm">
                  Delete
                </Button>
              </Dialog.Trigger>
              <ConfirmDialog
                title={`Delete ${team.is_personal ? 'account' : team.name}?`}
                description="All projects and associated data will be deleted."
                cta="Delete"
                variant="danger"
                loading={loading}
                onCTAClick={async () => {
                  if (!team) {
                    return;
                  }
                  setLoading(true);
                  if (team?.stripe_price_id) {
                    const res = await cancelSubscription(team.id);
                    if (res.status !== 200) {
                      toast.error(
                        `Could not cancel active subscription. Please contact ${
                          process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'us'
                        } to sort it out.`,
                      );
                      setLoading(false);
                      return;
                    }
                  }

                  const name = team.name;

                  // Deleting a personal account amounts to deleting a user
                  const isPersonalAccount = team.is_personal;
                  if (isPersonalAccount) {
                    await deleteUserAndMembershipsAndTeams();
                  } else {
                    await deleteTeamAndMemberships(team.id);
                  }
                  await mutateTeams(teams.filter((t) => t.id !== team.id));
                  await mutateTeam();
                  await mutateUser();
                  if (isPersonalAccount) {
                    toast.success(`Account has been deleted.`);
                  } else {
                    toast.success(`Team ${name} has been deleted.`);
                  }
                  setLoading(false);
                  if (isPersonalAccount) {
                    signOut();
                  }
                  Router.replace('/');
                }}
              />
            </Dialog.Root>
          </CTABar>
        </SettingsCard>
      </div>
      <Dialog.Root
        open={confirmDisconnectGitHubOpen}
        onOpenChange={(open) => setConfirmDisconnectGitHubOpen(open)}
      >
        <ConfirmDialog
          title="Disconnect GitHub"
          description="You will no longer be able to sync private repos."
          cta="Delete"
          variant="danger"
          loading={loading}
          onCTAClick={async () => {
            if (githubToken?.access_token) {
              const installations = await getAppInstallations(
                githubToken.access_token,
              );
              console.log(
                'installations',
                JSON.stringify(installations, null, 2),
              );
            }
            // const error = await disconnect('github');
            // if (error) {
            //   toast.error(`Error disconnecting: ${error.message}`);
            // } else {
            //   toast.success('Access revoked.');
            // }
          }}
        />
      </Dialog.Root>
    </TeamSettingsLayout>
  );
};

export default TeamSettingsPage;
