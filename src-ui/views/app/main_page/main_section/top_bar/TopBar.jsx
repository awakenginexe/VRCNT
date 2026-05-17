import styles from "./TopBar.module.scss";

import { SidebarCompactModeButton } from "./sidebar_compact_mode_button/SidebarCompactModeButton";
import { RightSideComponents } from "./right_side_components/RightSideComponents";

export const TopBar = () => {
    return (
        <div className={styles.container}>
            <SidebarCompactModeButton />
            <div className={styles.status_strip}>
                <p className={styles.product_name}>VRCNT</p>
                <p className={styles.product_desc}>VRChat Next Translation</p>
            </div>
            <RightSideComponents />
        </div>
    );
};
