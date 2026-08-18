import { useState } from "react";
import clsx from "clsx";
import styles from "./VersionLabel.module.scss";

import CopySvg from "@images/copy.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";
import packageInfo from "@root/package.json";

export const VersionLabel = ({ isCompact = false }) => {
    const [is_copied, setIsCopied] = useState(false);

    const software_version_number = packageInfo.version;

    const version_label = (
        <div className={clsx(styles.version_text_container, {
            [styles.is_compact]: isCompact,
            })}>
            <p className={styles.version_label}>{`v${software_version_number}`}</p>
        </div>
    );

    const copyToClipboard = async () => {
        if (is_copied || isCompact) return;
        await navigator.clipboard.writeText(software_version_number);
        setIsCopied(true);

        setTimeout(() => {
            setIsCopied(false);
        }, 1000);
    };

    return (
        <div className={clsx(styles.container, {
                [styles.is_compact]: isCompact,
            })}>
            <div className={clsx(styles.wrapper, {[styles.is_copied]: is_copied, [styles.is_compact]: isCompact})} onClick={copyToClipboard}>
                {version_label}
                {!isCompact && (
                    is_copied
                        ? <CheckMarkSvg className={styles.check_mark_svg}/>
                        : <CopySvg className={styles.copy_svg}/>
                )}
            </div>
        </div>
    );
};
