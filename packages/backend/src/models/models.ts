import { lightdashConfig } from '../config/lightdashConfig';
import database from '../database/database';
import { EncryptionService } from '../services/EncryptionService/EncryptionService';
import { DashboardModel } from './DashboardModel/DashboardModel';
import { EmailModel } from './EmailModel';
import { InviteLinkModel } from './InviteLinkModel';
import { OnboardingModel } from './OnboardingModel/OnboardingModel';
import { OpenIdIdentityModel } from './OpenIdIdentitiesModel';
import { OrganizationMemberProfileModel } from './OrganizationMemberProfileModel';
import { OrganizationModel } from './OrganizationModel';
import { PasswordResetLinkModel } from './PasswordResetLinkModel';
import { ProjectModel } from './ProjectModel/ProjectModel';
import { SessionModel } from './SessionModel';
import { UserModel } from './UserModel';

export const encryptionService = new EncryptionService({ lightdashConfig });

export const inviteLinkModel = new InviteLinkModel(database);
export const organizationModel = new OrganizationModel(database);
export const userModel = new UserModel(database);
export const sessionModel = new SessionModel(database);
export const dashboardModel = new DashboardModel({ database });
export const projectModel = new ProjectModel({
    database,
    lightdashConfig,
    encryptionService,
});
export const onboardingModel = new OnboardingModel({ database });
export const emailModel = new EmailModel({ database });
export const openIdIdentityModel = new OpenIdIdentityModel({ database });
export const passwordResetLinkModel = new PasswordResetLinkModel({
    database,
    lightdashConfig,
});
export const organizationMemberProfileModel =
    new OrganizationMemberProfileModel({ database });
