import { ApiError, DeleteOpenIdentity } from 'common';
import { useMutation, useQueryClient } from 'react-query';
import { lightdashApi } from '../../api';
import { useApp } from '../../providers/AppProvider';

const deleteOpenIdentity = async (data: DeleteOpenIdentity) =>
    lightdashApi<undefined>({
        url: `/user/identity`,
        method: 'DELETE',
        body: JSON.stringify(data),
    });

export const useDeleteOpenIdentityMutation = () => {
    const queryClient = useQueryClient();
    const { showToastSuccess, showToastError } = useApp();
    return useMutation<undefined, ApiError, DeleteOpenIdentity>(
        deleteOpenIdentity,
        {
            onSuccess: async () => {
                await queryClient.invalidateQueries('user_identities');
                showToastSuccess({
                    title: `Deleted! Social login was deleted.`,
                });
            },
            onError: (error) => {
                showToastError({
                    title: `Failed to delete social login`,
                    subtitle: error.error.message,
                });
            },
        },
    );
};
