/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import React, { useState, useEffect, useRef } from 'react';
import { ApiPromise } from '@polkadot/api';
import { Detector }  from '@substrate/connect';

export const emojis = {
	banknote: '💵',
	brick: '🧱',
	chain: '🔗',
	chequeredFlag: '🏁',
	clock: '🕒',
	info: 'ℹ️',
	newspaper: '🗞️',
	seedling: '🌱',
	stethoscope: '🩺',
	tick: '✅'
};

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

interface Prop {
  header: string
}

const Something = ({ header }: Prop) => {
  const [arr, setArr] = useState<string[]>([]);

  const prevHeader = usePrevious(header)
  const prevArr = usePrevious(arr);
  
  useEffect(() => {
      if (header !== prevHeader) {
          prevArr && setArr([...prevArr, header])
      }
  }, [prevHeader, header])

  return (
    <>
      {arr.map(a => <div>{a}</div>)}
    </>
  )
}

const App = () => {
	const [api, setApi] = useState<ApiPromise>({} as ApiPromise);
	const [header, setHeader] = useState<string>('0');
	const [msg, setMsg] = useState([`${emojis.chain} Chain is syncing...`]);

	useEffect(() => {
		const getApi = async () => {
			try {
				const detect = new Detector('Parcel Setup Demo');
				const ap = await detect.connect('westend') as unknown as ApiPromise;
				const chainName = await ap?.rpc?.system?.chain();
				const health = await ap?.rpc?.system.health();
				const peers = health.peers.toNumber() === 1 ? '1 peer' : `${health.peers} peers`;
				const tmp = [];
				tmp.push(`${emojis.seedling} Light client ready`);
				tmp.push(`${emojis.info} Connected to ${chainName}: syncing will start at block #${header}`);
				tmp.push(`${emojis.chequeredFlag} Genesis hash is ${ap?.genesisHash.toHex()}`);
				tmp.push(`${emojis.clock} Epoch duration is ${ap?.consts.babe.epochDuration.toNumber()} blocks`);
				tmp.push(`${emojis.banknote} ExistentialDeposit is ${ap?.consts.balances.existentialDeposit.toHuman()}`);
				tmp.push(`${emojis.stethoscope} Chain is syncing with ${peers}`);
				setMsg(tmp);
				setApi(ap);
			} catch (err) {
				console.log('err', err);
			}
		}
		void getApi();
	}, [])

	useEffect(() => {
			const sub = async () => {
					const chain = await api?.rpc?.system.chain();
					await api?.rpc?.chain.subscribeNewHeads((lastHeader: { number: any; hash: any; }) =>
							setHeader(`${chain}: last block #${lastHeader.number} has hash ${lastHeader.hash}`)
					);
			}
			void sub();
	}, [api])

  console.log('header', header)
	return (
		<>
			<h3>Substrate-connect demo with Parcel</h3>
			{msg.map(m => <p key={m}>{m}</p>)}
      <Something header={header} />
		</>
	)
}

export default App