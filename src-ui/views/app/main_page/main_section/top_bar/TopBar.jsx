import styles from "./TopBar.module.scss";

import { LiveWeaveNavigation } from "../live_weave_navigation/LiveWeaveNavigation";

export const TopBar = () => {
    return (
        <header className={styles.container}>
            <LiveWeaveNavigation />
        </header>
    );
};
