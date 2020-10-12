import Configstore from 'configstore';
import prompts from 'prompts';
import { promises as fs } from "fs"
import { spawn } from "child_process";
import { generateServerConfig, generateDeviceConfig, generateDNSFile } from '@wirt/config-generators'
import { getKeys, generateSigningKeys } from '@wirt/crypto'

const configPath = "./wirt-installer.config.json"

const config = new Configstore("wirt-installer", {}, { configPath });

const runAnsible = async ({
    user,
    serverIP,
    password,
    sshKey,
    wirtBotUIKey,
    domain,
    email,
    update,
    sshPrivateKeyPath,
    dnsConfig,
    serverConfig
}) => {
    console.log(sshKey)
    let args = [
        "-i", `${serverIP},`, "ansible/main.yml",
        "--extra-vars", `wirtui_public_key=${wirtBotUIKey}`,
        "--extra-vars", `maintainer_username=${user}`,
        "--extra-vars", `maintainer_ssh_key="${sshKey}"`,
        "--extra-vars", `maintainer_password=${password}`,
        "--extra-vars", `letsencrypt_email=${email}`,
        "--extra-vars", `domain_name=${domain}`,
        "--extra-vars", 'ansible_python_interpreter=/usr/bin/python3',
    ]
    console.log(args)

    const updateArguments = [
        `--extra-vars`, `ansible_become_pass=${password}`,
        '--private-key', `${sshPrivateKeyPath}`,
        `--user`, `${user}`,
    ]
    const installArguments = [
        `--user`, `root`,
        '--ask-pass',
        "--extra-vars", `initial_server_config=${serverConfig}`,
        "--extra-vars", `initial_dns_config=${dnsConfig}`,
        "--ssh-common-args='-o StrictHostKeyChecking=no'"
    ]
    if (update) {
        args = [...args, ...updateArguments]
    } else {
        console.log("If you have an SSH key on the server during initial setup, use an SSH config and simply hit Enter when asked for a password")
        args = [...args, ...installArguments]
    }

    const ansible = spawn("ansible-playbook", args);

    ansible.stdout.on("data", data => {
        console.log(`${data} `);
    });

    ansible.stderr.on("data", data => {
        console.log(`Error: ${data} `);
    });

    ansible.on('error', (error) => {
        console.log(`Error: ${error.message} `);
    });

    ansible.on("close", code => {
    });


}


const main = async () => {
    const updateOrInstallQuestions = [
        {
            type: 'select',
            name: 'value',
            message: 'Choose a mode',
            choices: [
                { title: 'Update', description: 'Update an existing installation', value: 'update' },
                { title: 'Install', description: 'Install a new WirtBot', value: 'install' },
            ],
            initial: 1
        }

    ]
    // TODO: verify the inputs
    const questionsInstall = [
        {
            type: config.get('serverIP') ? null : 'text',
            name: 'serverIP',
            message: 'What is the IP address of your server?'
        },
        {
            type: config.get('user') ? null : 'text',
            name: 'user',
            message: 'Maintenance user name'
        },
        {
            type: 'text',
            name: 'password',
            message: 'Password for the maintenance user'
        },
        // TODO: make open SSH port optional
        {
            type: config.get('sshKey') ? null : 'text',
            name: 'sshKey',
            message: 'Please paste the Public Key of the keypair you want to use for accessing the WirtBot via SSH'
        },
        // TODO: Readd domain name generation
        // Ask first if a domain name is wanted
        // Add ticket
        // {
        //     type: config.get('domain') ? null : 'text',
        //     name: 'domain',
        //     message: 'Domain name that points to WirtBot'
        // },
        // {
        //     type: config.get('email') ? null : 'text',
        //     name: 'email',
        //     message: 'Email for SSL certificate'
        // },
    ];
    const questionsUpdate = [
        {
            type: 'text',
            name: 'password',
            message: 'Password for the maintenance user'
        },
        {
            type: config.get('sshPrivateKeyPath') ? null : 'text',
            name: 'sshPrivateKeyPath',
            message: 'Path to private key to enter WirtBot via SSH'
        },
    ];

    const updateOrInstall = await prompts(updateOrInstallQuestions);
    if (updateOrInstall["value"] === 'install') {
        const response = await prompts(questionsInstall);
        console.log("Configuration written to", configPath)
        try {
            Object.keys(response).forEach(entry => {
                if (entry !== 'password') {
                    config.set(entry, response[entry])
                }
            })

            const serverKeys = await getKeys();
            const deviceKeys = await getKeys();
            const signingKeys = await generateSigningKeys()
            const device = { ip: { v4: 2 }, name: "Change me", keys: deviceKeys }
            // TODO: Fix IPv4 to always be a string 
            // needs changes in many places
            const server = { ip: { v4: config.get('serverIP').split('.') }, port: 10101, keys: serverKeys, subnet: { v4: "10.10.0." } }
            const serverConfig = generateServerConfig(server, [device])
            const deviceConfig = generateDeviceConfig(device, server)
            const dnsConfig = generateDNSFile(server, [device], { dns: { name: "wirt.internal" } })

            runAnsible(Object.assign({}, config.all, { password: response.password, wirtBotUIKey: signingKeys.public, update: false, serverConfig, dnsConfig }))
            console.log("DONE")
            console.log(deviceConfig)
            console.log(serverConfig)
            console.log({
                state: {
                    // TODO keep this version somewhere else
                    version: 1.1,
                    server,
                    devices: [device],
                    keys: signingKeys
                }
            })
        } catch (error) {
            console.error(error)
        }
    }
    if (updateOrInstall["value"] === 'update') {
        const response = await prompts(questionsUpdate);
        console.log("Configuration written to", configPath)
        Object.keys(response).forEach(entry => {
            if (entry !== 'password') {
                config.set(entry, response[entry])
            }
        })
        runAnsible(Object.assign({}, config.all, { password: response.password, update: true, sshPrivateKeyPath: response.sshPrivateKeyPath }))
    }


};

main();
