import { useState } from "react";

import { ColorPicker } from "./ColorPicker.jsx";
import styles from "./ColorRoleEditor.module.scss";

export const ColorRoleEditor = ({
    groups = [],
    palette = {},
    onChangeRole,
    onResetRole,
    onResetAll,
    resetLabel = "Reset all colors",
    getContrastWarning,
    labels = {},
}) => {
    const [activeRole, setActiveRole] = useState(null);
    const copy = {
        kicker: "Color roles",
        title: "Make it yours",
        description: "Choose a color wheel value or type an exact hex code.",
        reset: "Reset",
        ...labels,
    };

    return (
        <div className={styles.editor}>
            <div className={styles.editor_header}>
                <div>
                    <p className={styles.kicker}>{copy.kicker}</p>
                    <h2>{copy.title}</h2>
                    <p className={styles.description}>{copy.description}</p>
                </div>
                <button className={styles.reset_all} type="button" onClick={onResetAll}>{resetLabel}</button>
            </div>
            <div className={styles.groups}>
                {groups.map((group) => (
                    <section className={styles.group} key={group.id}>
                        <div className={styles.group_heading}>
                            <h3>{group.label ?? group.id}</h3>
                            {group.description ? <p>{group.description}</p> : null}
                        </div>
                        <div className={styles.roles}>
                            {group.roles.map((role) => (
                                <div className={styles.role} key={role.id}>
                                    <div className={styles.role_copy}>
                                        <h4>{role.label ?? role.id}</h4>
                                        {role.description ? <p>{role.description}</p> : null}
                                    </div>
                                    <div className={styles.role_actions}>
                                        <ColorPicker
                                            label={role.label ?? role.id}
                                            value={palette[role.id]}
                                            description={null}
                                            contrastWarning={getContrastWarning?.(role.id, palette[role.id])}
                                            open={activeRole === role.id}
                                            onOpenChange={(next) => setActiveRole(next ? role.id : null)}
                                            onChange={(value) => onChangeRole?.(role.id, value)}
                                            labels={labels}
                                        />
                                        <button
                                            className={styles.reset_role}
                                            type="button"
                                            onClick={() => onResetRole?.(role.id)}
                                            aria-label={`Reset ${role.label ?? role.id}`}
                                        >
                                            {copy.reset}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
};
